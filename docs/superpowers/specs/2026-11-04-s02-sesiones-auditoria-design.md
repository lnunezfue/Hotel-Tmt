# S-02 — Sesiones con renovación, inactividad y auditoría

| | |
|---|---|
| Sprint | S-02 (fase F1 · Núcleo y seguridad) del DT-001 |
| Fecha | 2026-11-04 |
| Estado | Diseño aprobado en conversación · pendiente de revisión escrita |
| Requerimientos | RF-SEG-04, RF-SEG-05, RNF-13, RNF-14, RNF-15, RNF-16, RNF-27, RNF-32 · DT-001 §4.4, §5.1 |

## 1. Objetivo

Cerrar S-02. Resultado verificable del DT-001: **"Un usuario inicia sesión y ve solo lo que su rol permite"**.

Ya existe: login con JWT en cookie httpOnly, Argon2id, bloqueo tras 3 intentos, guard global de permisos (`@RequierePermiso`) y rutas protegidas en el cliente. Falta:

1. **Renovación de sesión** (§5.1): token de acceso de vida corta + token de renovación, ambos en cookies httpOnly. Hoy hay un único JWT de 8 h que no se puede revocar.
2. **Cierre por inactividad configurable** (RF-SEG-04).
3. **Bitácora de auditoría** de operaciones sensibles con usuario, fecha, IP y valores antes/después (RF-SEG-05, RNF-16). La tabla `auditoria` existe pero nada escribe en ella.
4. **Limitador de intentos** sobre login y renovación (§5.1, "Helmet y limitador de peticiones").

## 2. Alcance

**Dentro**
- Migración `20261105000000_sesiones_y_auditoria` (tabla `sesion_usuario`, columna en `empresa`, cambios en `auditoria`).
- Endpoints `POST /auth/refresh`; cambios en `login`, `logout`, `sucursal`, `me` y en el guard.
- Módulo `auditoria`: contexto de petición, servicio, decorador `@Auditar` e interceptor global.
- Auditoría de los eventos de sesión y de `habitacion.crear`.
- Limitador con `@nestjs/throttler` en `/auth/login` y `/auth/refresh`.
- Cliente: renovación transparente, detector de inactividad con aviso, mensajes de cierre por motivo.
- Fallo al arrancar en producción si falta `JWT_SECRET`.
- Pruebas unitarias, de integración (nuevo `test:e2e`) y de cliente; paso nuevo en CI; README actualizado.

**Fuera (y dónde va)**
- Crear/editar usuarios, desbloqueo, cambio y restablecimiento de contraseña, cierre de sesiones por un administrador → S-03.
- Revocar las sesiones de un usuario al desactivarlo → S-03 (el valor `ADMIN`/`USUARIO_INACTIVO` ya queda previsto; mientras tanto, el usuario desactivado pierde acceso en su siguiente renovación).
- Pantalla o endpoint para consultar la bitácora → F5 (reportes).
- Auditoría de emisión, anulación, tarifas y caja → se conecta con el mismo mecanismo cuando existan esos módulos.
- Identificador de correlación en logs (RNF-39) → con la adopción de Pino.

## 3. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Sesiones **con estado** en tabla `sesion_usuario`; token de renovación opaco, guardado como hash SHA-256, **rotado en cada uso** | Permite revocar, detectar robo y releer permisos; requisito de trazabilidad (RNF-16, RNF-18) |
| D2 | Tiempo de inactividad **por empresa** (`empresa.sesion_inactividad_min`, por defecto 30) | "Configurable" sin redespliegue; un solo valor para todo el personal |
| D3 | Auditoría con **decorador + interceptor**, escrita por el servicio **dentro de su transacción** | La operación y su registro se confirman juntos; el interceptor detecta olvidos |
| D4 | Acceso 15 min · sesión máxima 12 h · tolerancia de carrera 30 s | 15 min acota el retraso de una revocación; 12 h es un turno; 30 s absorbe renovaciones simultáneas de dos pestañas |
| D5 | La inactividad se mide **en el navegador** (principal) y el servidor aplica un **respaldo** | El tablero consulta cada 15 s solo; el servidor no distingue eso de trabajo real |
| D6 | `auditoria.accion` pasa a `VARCHAR(40)` con códigos `modulo.accion` | Cada módulo nuevo añade códigos sin alterar el esquema |
| D7 | Bitácora **inmutable** por triggers | Una bitácora editable no es prueba |

## 4. Modelo de datos

Migración SQL escrita a mano (el esquema SQL es la fuente de verdad), seguida de `python3 api/scripts/gen-prisma-schema.py hotel_dev`. Junto a `migration.sql` se incluye `down.sql` con la reversión manual (RNF-32; Prisma no ejecuta reversiones).

```sql
CREATE TABLE sesion_usuario (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id             INT UNSIGNED    NOT NULL,
  sucursal_id            INT UNSIGNED    NOT NULL COMMENT 'Sucursal activa',
  refresh_hash           CHAR(64)        NOT NULL COMMENT 'SHA-256 hex del secreto vigente',
  refresh_hash_anterior  CHAR(64)        NULL     COMMENT 'Secreto previo, válido solo durante la tolerancia de carrera',
  rotada_at              DATETIME        NULL,
  ip                     VARCHAR(45)     NULL,
  user_agent             VARCHAR(255)    NULL,
  creada_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_renovacion_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at              DATETIME        NOT NULL COMMENT 'creada_at + duración máxima',
  revocada_at            DATETIME        NULL,
  motivo_revocacion      ENUM('LOGOUT','INACTIVIDAD','REUSO','USUARIO_INACTIVO','EXPIRADA','ADMIN') NULL,
  PRIMARY KEY (id),
  KEY ix_sesion_usuario (usuario_id, revocada_at),
  CONSTRAINT fk_sesion_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuario (id),
  CONSTRAINT fk_sesion_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id),
  CONSTRAINT ck_sesion_expira   CHECK (expira_at > creada_at),
  CONSTRAINT ck_sesion_revocada CHECK ((revocada_at IS NULL) = (motivo_revocacion IS NULL))
) ENGINE=InnoDB COMMENT='Sesiones de usuario con token de renovación rotativo';

ALTER TABLE empresa
  ADD COLUMN sesion_inactividad_min SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER igv_porcentaje,
  ADD CONSTRAINT ck_empresa_inactividad CHECK (sesion_inactividad_min BETWEEN 15 AND 480);

ALTER TABLE auditoria
  MODIFY COLUMN accion      VARCHAR(40)     NOT NULL COMMENT 'Código modulo.accion; lista en ACCIONES_AUDITORIA',
  MODIFY COLUMN registro_id BIGINT UNSIGNED NULL,
  ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER usuario_id,
  ADD COLUMN user_agent  VARCHAR(255) NULL AFTER ip,
  ADD KEY ix_aud_usuario_fecha (usuario_id, created_at),
  ADD CONSTRAINT fk_aud_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id);

-- Inmutabilidad (D7)
CREATE TRIGGER trg_aud_bu_inmutable BEFORE UPDATE ON auditoria FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitácora de auditoría no se modifica';
CREATE TRIGGER trg_aud_bd_prohibido BEFORE DELETE ON auditoria FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitácora de auditoría no se elimina';
```

La tabla `auditoria` está vacía en todos los entornos, por lo que el cambio de tipo de `accion` no requiere conversión de datos. Las filas de `sesion_usuario` no se purgan en esta versión (volumen estimado: decenas por día).

## 5. Sesión

### 5.1 Cookies y tokens

| Cookie | Contenido | Ruta | Vida | Atributos |
|---|---|---|---|---|
| `hotel_sesion` | JWT de acceso: `sub, sid, username, nombre, empresaId, rol, permisos, sucursales, sucursalId, inactividadMin` | `/` | `JWT_ACCESO_MIN` (15 min) | httpOnly, SameSite=Lax, Secure en producción |
| `hotel_renovacion` | `<sesionId>.<secreto>`; secreto = 32 bytes aleatorios en base64url | `/api/auth` | hasta `expira_at` (12 h) | httpOnly, SameSite=Lax, Secure en producción |

`sid` es el id de `sesion_usuario`. El secreto se compara por hash con `crypto.timingSafeEqual`.

### 5.2 Guard (cada petición)

Sin cambios de fondo: verifica el JWT de acceso y el permiso del endpoint, **sin consultar la base**. Distingue errores:
- sin cookie o firma inválida → 401 `SIN_SESION`;
- JWT vencido (`TokenExpiredError`) → 401 `ACCESO_EXPIRADO`.

Riesgo aceptado: un token de acceso copiado sigue sirviendo hasta 15 min tras una revocación.

### 5.3 Login — `POST /auth/login` (público, limitado)

Validación de credenciales como hoy. Si tiene éxito, en una transacción: resetea intentos, crea `sesion_usuario` (sucursal principal, `expira_at = ahora + SESION_MAX_HORAS`), registra `auth.login`. Responde las dos cookies y el usuario. Si falla (usuario inexistente, inactivo, bloqueado o clave errónea) registra `auth.login_fallido` con `{ username, motivo }` en `datos_despues` y `registro_id` = id del usuario o nulo. El mensaje al usuario no cambia. Un usuario sin ninguna sucursal asignada recibe 403 "Tu usuario no tiene sucursales asignadas. Consulta con un administrador" y se registra como `auth.login_fallido` con motivo `SIN_SUCURSALES` (hoy produciría un error 500).

### 5.4 Renovación — `POST /auth/refresh` (público, limitado)

1. Leer `hotel_renovacion`; si falta o está mal formada → 401 `SIN_SESION`.
2. En una transacción, `SELECT … FOR UPDATE` de la sesión por id (serializa renovaciones concurrentes de la misma sesión). Si no existe → 401 `SIN_SESION`.
3. Cargar usuario con rol, permisos, sucursales y `empresa.sesion_inactividad_min`.
4. Aplicar la función pura `decidirRenovacion(sesion, hashPresentado, ahora, config)`, que evalúa en este orden:

| Condición | Resultado |
|---|---|
| `revocada_at` no nulo | `RECHAZAR(motivo guardado)` |
| `ahora > expira_at` | `REVOCAR(EXPIRADA)` |
| `ahora − ultima_renovacion_at > inactividadMin + JWT_ACCESO_MIN` | `REVOCAR(INACTIVIDAD)` |
| hash = `refresh_hash` | `ROTAR` |
| hash = `refresh_hash_anterior` y `ahora − rotada_at ≤ REFRESH_GRACIA_SEG` | `CARRERA` |
| cualquier otro caso | `REVOCAR(REUSO)` |

5. Después, si el usuario está inactivo o ya no tiene ninguna sucursal asignada → `REVOCAR(USUARIO_INACTIVO)`.
6. Efectos:
   - `ROTAR`: `refresh_hash_anterior ← refresh_hash`, nuevo secreto, `rotada_at = ultima_renovacion_at = ahora`; si la sucursal activa ya no está asignada, se cambia a la principal; se emiten ambas cookies con permisos releídos.
   - `CARRERA`: solo se emite un JWT de acceso nuevo; no se toca la cookie de renovación (el navegador ya tiene la vigente, las cookies son compartidas entre pestañas).
   - `REVOCAR(m)`: `revocada_at = ahora`, `motivo_revocacion = m`, registro `auth.sesion_revocada`; se borran las cookies; 401 `SESION_CERRADA` con `motivo = m`.
   - `RECHAZAR(m)`: se borran las cookies; 401 `SESION_CERRADA` con `motivo = m`.

La revocación debe confirmarse **antes** de responder 401: el servicio devuelve el resultado y el controlador lanza el error después de la transacción (lanzarlo dentro la desharía).

El margen `+ JWT_ACCESO_MIN` del respaldo existe porque un cliente activo renueva como máximo cada 15 min; sin él, una empresa configurada en 15 min cerraría sesiones en uso. Un dispositivo apagado o un token sustraído deja de servir a lo sumo `inactividadMin + 15` minutos después de la última renovación.

### 5.5 Logout — `POST /auth/logout` (público)

Cuerpo opcional `{ motivo?: 'INACTIVIDAD' }`. Si la cookie de renovación corresponde a una sesión vigente, la revoca con `LOGOUT` o `INACTIVIDAD` y registra `auth.logout`. Siempre borra ambas cookies y responde 204. Es público para que funcione aunque el acceso ya haya vencido.

### 5.6 Cambio de sucursal — `POST /auth/sucursal`

Valida la sucursal contra las asignadas (como hoy), y en una transacción actualiza `sesion_usuario.sucursal_id` (por `sid`) y registra `auth.cambio_sucursal` con antes/después. Emite un JWT de acceso nuevo. Si la sesión `sid` ya está revocada (el acceso aún no venció) → 401 `SESION_CERRADA` y no se modifica nada.

### 5.7 `GET /auth/me`

Devuelve el contenido del JWT de acceso, que ahora incluye `inactividadMin`.

## 6. Inactividad en el cliente

Hook `useInactividad(minutos)` montado en `Layout`:
- Escucha `keydown`, `pointerdown`, `wheel` y `touchstart` (pasivos, con limitación a un evento por segundo).
- Comparte la última actividad entre pestañas con `BroadcastChannel('hotel-actividad')`, envuelto en try/catch; sin soporte, cada pestaña cuenta por su cuenta.
- 60 s antes del límite muestra `AvisoInactividad`: diálogo con cuenta regresiva y botón "Seguir trabajando" con foco inicial (operable por teclado, RNF-25). Cualquier actividad lo cierra.
- Al llegar al límite llama a `logout` con `motivo: 'INACTIVIDAD'` y lleva al login con el mensaje correspondiente.

## 7. Auditoría

### 7.1 Componentes

| Pieza | Ubicación | Responsabilidad |
|---|---|---|
| Contexto de petición | `api/src/common/contexto-peticion.ts` + middleware | `AsyncLocalStorage` con `usuarioId, sucursalId, ip, userAgent, registros[]`. La IP sale de `req.ip`; `trust proxy` según `TRUST_PROXY` |
| Catálogo de acciones | `api/src/modules/auditoria/domain/acciones.ts` | Constante `ACCIONES_AUDITORIA` y tipo `AccionAuditoria` |
| Sanitizador | `api/src/modules/auditoria/domain/sanitizar.ts` | Función pura: oculta claves que coinciden con `/password|hash|token|secreto|clave/i` (valor `"[oculto]"`), convierte `bigint` y `Decimal` a texto y `Date` a ISO |
| Servicio | `api/src/modules/auditoria/application/auditoria.service.ts` | `registrar(tx, { accion, tabla, registroId, antes?, despues?, usuarioId? })`: inserta con el cliente de transacción recibido, completa usuario/sucursal/IP/navegador del contexto (`usuarioId` explícito para login), sanitiza y anota la acción en `registros[]` |
| Decorador | `@Auditar(accion)` | Declara que el endpoint es sensible |
| Interceptor global | `AuditoriaInterceptor` | Tras una respuesta exitosa de un endpoint con `@Auditar`, comprueba que `registros[]` contiene la acción. Si no: en desarrollo y pruebas lanza 500; en producción deja un error en el log |

Solo se audita lo que se confirma; los fallos no se auditan, salvo `auth.login_fallido`, que es un evento de seguridad y se escribe fuera de transacción.

### 7.2 Acciones al cerrar S-02

| Acción | `tabla` / `registro_id` | Datos |
|---|---|---|
| `auth.login` | `sesion_usuario` / id de sesión | — |
| `auth.login_fallido` | `usuario` / id o nulo | `{ username, motivo }` |
| `auth.logout` | `sesion_usuario` / id | `{ motivo }` |
| `auth.sesion_revocada` | `sesion_usuario` / id | `{ motivo }` |
| `auth.cambio_sucursal` | `sesion_usuario` / id | antes y después `{ sucursal_id }` |
| `habitacion.crear` | `habitacion` / id | después: fila creada |

`HospedajeService.crearHabitacion` pasa a ejecutarse en una transacción para registrar `habitacion.crear` dentro de ella. El cambio de estado de habitación no se audita aquí porque ya tiene su historial (`habitacion_estado_historial`).

## 8. Limitador de intentos

`@nestjs/throttler` aplicado con `@UseGuards(ThrottlerGuard)` solo en `login` y `refresh`: `LIMITE_AUTH_POR_MIN` peticiones por minuto por IP (10 por defecto), almacenamiento en memoria. Las pruebas de integración lo elevan, salvo la que verifica el propio límite. Excedido → 429 con el mensaje "Demasiados intentos. Espera un minuto e inténtalo de nuevo". Con dos réplicas (§4.6) se migrará a almacenamiento en Redis.

## 9. Cliente web

- `lib/api.ts`: ante 401 `ACCESO_EXPIRADO`, una única llamada a `/auth/refresh` compartida por todas las peticiones en espera (promesa a nivel de módulo) y reintento de la original una sola vez. Las llamadas a `/auth/login`, `/auth/refresh` y `/auth/logout` no entran en ese ciclo. `ApiError` incorpora `codigo` y `motivo`.
- Si la renovación falla, se fija `['sesion']` en nulo, se limpia la caché y `Protegida` redirige a `/login?motivo=<MOTIVO>`.
- `LoginPage` muestra el mensaje según el motivo:

| Motivo | Mensaje |
|---|---|
| `INACTIVIDAD` | Tu sesión se cerró por inactividad. Vuelve a ingresar. |
| `EXPIRADA` | Tu turno de sesión terminó. Vuelve a ingresar. |
| `REUSO` | Cerramos tu sesión por seguridad. Vuelve a ingresar. |
| `USUARIO_INACTIVO` | Tu usuario fue desactivado. Consulta con un administrador. |
| `ADMIN` | Un administrador cerró tu sesión. |

- `Sesion` incorpora `inactividadMin`.

## 10. Errores de la API

Los 401 llevan cuerpo `{ message, codigo, motivo? }`; los mensajes están en español y no exponen detalles técnicos (RNF-27).

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `SIN_SESION` | Sin cookie, firma inválida o sesión inexistente |
| 401 | `ACCESO_EXPIRADO` | JWT de acceso vencido; el cliente debe renovar |
| 401 | `SESION_CERRADA` | Renovación denegada; incluye `motivo` |
| 403 | — | Sin permiso o usuario bloqueado (como hoy) |
| 429 | — | Limitador excedido |

## 11. Configuración

| Variable | Valor por defecto | Nota |
|---|---|---|
| `JWT_SECRET` | — | Obligatoria con `NODE_ENV=production`; la API no arranca sin ella. En desarrollo conserva el valor de respaldo |
| `JWT_ACCESO_MIN` | 15 | Reemplaza a `JWT_EXPIRES_IN`, que se elimina |
| `SESION_MAX_HORAS` | 12 | |
| `REFRESH_GRACIA_SEG` | 30 | |
| `TRUST_PROXY` | `false` | `1` detrás de Nginx/Caddy |
| `LIMITE_AUTH_POR_MIN` | 10 | Límite por IP en login y renovación |

Se actualiza `api/.env.example`.

## 12. Pruebas

**Unitarias (Jest, sin base de datos)**
- `decidirRenovacion`: cada fila de la tabla de §5.4, incluidos los bordes de 30 s y del respaldo de inactividad.
- `sanitizar`: ocultamiento por clave, anidados, `bigint`, `Decimal`, `Date`.

**Integración (Supertest contra MySQL real, script `test:e2e`, paso nuevo en CI)**
1. Login → crea sesión y registra `auth.login`.
2. Acceso vencido → `ACCESO_EXPIRADO`; refresh → rota el hash y ambas cookies.
3. Reusar un token rotado tras la tolerancia → 401 `REUSO` y la sesión queda revocada.
4. Dos renovaciones con el mismo token dentro de 30 s → ambas exitosas, la sesión sigue viva.
5. Sesión sin renovar más allá del respaldo → `INACTIVIDAD`.
6. Usuario desactivado → `USUARIO_INACTIVO` en la siguiente renovación.
7. Cambio de permisos del rol → reflejado tras renovar.
8. Logout → sesión revocada, cookies borradas, `auth.logout` registrado; funciona con acceso vencido.
9. Login fallido → `auth.login_fallido` con IP.
10. `UPDATE`/`DELETE` sobre `auditoria` → error del motor.
11. Endpoint de prueba con `@Auditar` que no registra → 500 en entorno de pruebas.
12. Limitador (con `LIMITE_AUTH_POR_MIN=10`): la petición 11 del minuto → 429.

**Cliente (Vitest)**
- Renovación única ante varias peticiones vencidas simultáneas y reintento.
- `useInactividad` con temporizadores simulados: aviso a los 60 s, reinicio por actividad, cierre al límite.

## 13. Archivos afectados

- `api/prisma/migrations/20261105000000_sesiones_y_auditoria/{migration.sql,down.sql}`, `api/prisma/schema.prisma` (regenerado). `seed.ts` no cambia: no toca `auditoria` ni sesiones, y `sesion_inactividad_min` toma su valor por defecto.
- `api/src/main.ts`, `api/src/app.module.ts`, `api/src/common/contexto-peticion.ts`, `api/src/common/usuario-actual.decorator.ts`.
- `api/src/modules/auth/*` (controller, guard, service, module; nuevo `domain/renovacion.ts` con su prueba).
- `api/src/modules/auditoria/*` (nuevo).
- `api/src/modules/hospedaje/application/hospedaje.service.ts`, `hospedaje.controller.ts`.
- `api/test/*.e2e-spec.ts` (nuevo), `api/package.json`, `api/.env.example`, `.github/workflows/ci.yml`.
- `web/src/lib/api.ts`, `web/src/features/auth/{sesion.tsx,useInactividad.ts}`, `web/src/components/{Layout.tsx,AvisoInactividad.tsx}`, `web/src/pages/LoginPage.tsx` y sus pruebas.
- `README.md`.

## 14. Criterio de terminado

- Se cumple el resultado verificable de S-02: con los usuarios de ejemplo, cada rol ve y puede hacer solo lo que su rol permite, y la API rechaza lo demás aunque se llame directamente.
- Todas las pruebas de §12 pasan en CI junto con `typecheck` y `build`.
- Verificación manual en la demo: renovación transparente, aviso y cierre por inactividad, mensaje correcto en el login, registros visibles en `auditoria`.
- README: S-02 marcado como **Completo** y requerimientos RF-SEG-04 y RF-SEG-05 añadidos a la cobertura.
