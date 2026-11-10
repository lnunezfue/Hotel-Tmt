# S-05 — Tablero de habitaciones en vivo

| | |
|---|---|
| Sprint | S-05 (F2 · tablero en vivo) del DT-001 |
| Fecha | 2026-11-09 |
| Estado | Diseño aprobado; pendiente de plan e implementación en la rama `s05-tablero-en-vivo` (parte de `s03-s04-organizacion-hotel`) |
| Requerimientos | RF-RES-05 (tablero con actualización sin recargar) · RNF-02 (carga del tablero ≤ 1,5 s con 120 habitaciones) |
| Depende de | S-02 (sesiones revocables, guard global), S-04 (configuración de habitaciones, pisos y tipos) |

## 1. Objetivo

Resultado verificable del DT-001: **"El tablero refleja cambios de estado sin recargar"**.

En concreto: con dos navegadores en la misma sucursal, un cambio hecho en uno aparece en el otro en menos de 1 s. Hoy tarda hasta 15 s, porque el tablero se consulta por intervalo.

## 2. Alcance

**Dentro**
- Flujo de avisos del servidor al navegador con Server-Sent Events (SSE): `GET /hospedaje/tablero/eventos`.
- Publicación de un aviso cada vez que cambia algo que el tablero muestra (§4.2).
- Reparto de avisos entre réplicas de la API mediante Redis pub/sub.
- Cliente: hook `useTableroEnVivo`, indicador de conexión y consulta de respaldo cada 60 s.
- Preparación: `web/src/lib/api.ts` pasa a carpeta `web/src/lib/api/` y se actualiza el árbol del README (§7).

**Fuera (y dónde va)**
- Administración de canales de venta y turnos (alta, edición, comisión) → rama propia, antes de S-06. Hoy son de solo lectura.
- Avisos por reservas, check-in y check-out → S-06; usarán el mismo notificador (§4.2).
- Carpetas `compras/`, `caja/`, `reportes/` y `emision.processor.ts` del DT-001 §4.3 → se crean en sus fases (F3 a F5).
- Límite de flujos abiertos por sesión → no se implementa; el cliente abre uno por pestaña visible (§5.1).

## 3. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | SSE en lugar de WebSocket | El tablero solo necesita avisos del servidor al navegador; los cambios siguen entrando por REST. SSE reutiliza la cookie y el guard actuales; WebSocket exigiría una segunda ruta de autenticación sobre las sesiones de S-02. El DT-001 pide "sin recargar", no WebSocket |
| D2 | El aviso no lleva datos: dice "el tablero cambió" y el navegador vuelve a pedir `GET /hospedaje/tablero` | Una sola fuente de verdad; un aviso perdido, repetido o desordenado no deja el tablero incoherente |
| D3 | Redis pub/sub desde el primer día, aunque en desarrollo haya una sola instancia | El DT-001 §4.6 despliega dos réplicas; un bus en memoria funcionaría en desarrollo y fallaría en producción |
| D4 | El aviso se publica **después** de confirmar la transacción y su fallo no falla la petición | El cambio de estado es lo que importa; si Redis no responde, lo cubre la consulta de respaldo |
| D5 | El flujo se cierra al vencer el token de acceso con el que se abrió | Una sesión revocada deja de recibir avisos en 15 min como máximo, el mismo plazo aceptado en S-02 §5.3. No se consulta la base por cada aviso |
| D6 | Se mantiene la consulta periódica, de 15 s a 60 s | Red de seguridad ante avisos perdidos; además refresca las alertas de salida, que cambian con el reloj y no con un evento |
| D7 | El flujo solo vive con el tablero en pantalla y la pestaña visible | Los navegadores limitan a 6 las conexiones HTTP/1.1 por origen; varias pestañas con flujo abierto bloquearían el resto de peticiones |

## 4. API

### 4.1 Endpoint

`GET /hospedaje/tablero/eventos` — `text/event-stream`.

- Protegido por el `AuthGuard` global, sin permiso adicional (igual que `GET /hospedaje/tablero`). Sin cookie válida: 401 `SIN_SESION` o `ACCESO_EXPIRADO`, como cualquier endpoint.
- La sucursal sale del token (`sucursalId`), nunca de un parámetro.
- Cabeceras: `Cache-Control: no-cache, no-transform` y `X-Accel-Buffering: no` (evita que Nginx retenga los eventos).
- Eventos:
  - `tablero` con datos `{ "motivo": "estado" | "habitacion" | "piso" | "tipo" }`. El motivo es informativo; el cliente reacciona igual a todos.
  - `latido` cada 25 s, sin datos, para que el proxy no cierre la conexión por inactividad.
- El servidor termina el flujo cuando llega el `exp` del token (D5).
- El flujo no renueva la sesión ni cuenta como actividad del usuario: es una petición GET con el token de acceso, y la inactividad se mide en el cliente (S-02).

### 4.2 Qué publica un aviso

| Operación | Servicio | Motivo | Destino |
|---|---|---|---|
| Cambiar estado de habitación | `HospedajeService.cambiarEstado` | `estado` | Sucursal de la habitación |
| Crear habitación | `HospedajeService.crearHabitacion` | `habitacion` | Sucursal del token |
| Editar o desactivar habitación | `ConfiguracionService.editarHabitacion` | `habitacion` | Sucursal del token |
| Crear o editar piso | `ConfiguracionService.crearPiso`, `editarPiso` | `piso` | Sucursal del token |
| Editar tipo de habitación | `ConfiguracionService.editarTipo` | `tipo` | Todas las sucursales de la empresa (el tipo es de empresa) |

Crear un tipo y editar tarifas no publican: no cambian lo que el tablero muestra.

La publicación va tras el `await` de la transacción, envuelta de modo que un error de Redis se registra en el log y no se propaga (D4).

### 4.3 Componentes

Siguen las capas del módulo `hospedaje` (DT-001 §4.2):

| Archivo | Capa | Responsabilidad |
|---|---|---|
| `domain/aviso-tablero.ts` | Dominio | Tipo `AvisoTablero { sucursalId, motivo }`, nombre del canal (`tablero:sucursal:{id}`), validación del mensaje recibido. Lógica pura |
| `domain/notificador-tablero.port.ts` | Dominio | Puerto `NotificadorTablero`: `publicar(aviso)` y `escuchar(sucursalId): Observable<AvisoTablero>`, con su token de inyección |
| `application/flujo-tablero.ts` | Aplicación | Une los avisos con el latido y corta al llegar `exp`. Función pura sobre RxJS |
| `application/avisos-tablero.service.ts` | Aplicación | Lo que usan los servicios para avisar: publica sin propagar errores (D4) y reparte a todas las sucursales de una empresa |
| `infrastructure/notificador-tablero.redis.ts` | Infraestructura | Adaptador con `ioredis`: una conexión para publicar y otra para suscribirse |
| `tablero-eventos.controller.ts` | Presentación | `@Sse('tablero/eventos')`: conecta `escuchar(sucursalId)` con `flujo-tablero` |

Detalles del adaptador:

- **Suscripción perezosa.** La conexión suscriptora se abre con el primer flujo y usa un solo `PSUBSCRIBE tablero:sucursal:*` por proceso; reparte en memoria a los flujos de cada sucursal. El trabajador (`worker.ts`) carga el mismo módulo y así no abre una suscripción que no usa.
- **Mensajes no válidos se descartan.** Lo que llega de Redis se valida antes de reenviarlo.
- **Redis caído no tumba la API.** Las conexiones reintentan solas y sus errores se registran. La conexión de publicación no encola mientras está desconectada: un aviso viejo entregado tarde no aporta, y el respaldo ya cubre el hueco.
- **Cierre ordenado.** `onModuleDestroy` cierra ambas conexiones y completa los flujos abiertos.

### 4.4 Configuración

- `REDIS_URL`: por defecto `redis://localhost:6379`; obligatoria en producción (mismo criterio que `JWT_SECRET`). Se añade a `.env.example` y a la validación de `config.ts`.
- Dependencia nueva en la API: `ioredis`.

## 5. Cliente

### 5.1 Hook `useTableroEnVivo` (`web/src/features/hospedaje/`)

Devuelve el estado de conexión: `conectando`, `en-vivo` o `reconectando`.

- Abre `EventSource('/api/hospedaje/tablero/eventos')` mientras `TableroPage` está montada y la pestaña es visible (D7). Al ocultarse la pestaña, cierra; al volver, abre de nuevo.
- **Al abrir** (`open`): invalida la consulta `['tablero']`. Cubre los cambios ocurridos entre la carga inicial y la apertura del flujo, y los ocurridos con la pestaña oculta.
- **Al recibir `tablero`**: invalida `['tablero']` y, si hay una habitación seleccionada, su `['historial', id]`.
- **Al fallar** (`error`): cierra el `EventSource` (no se usa su reintento automático, que no distingue un 401 de un corte de red), pasa a `reconectando` y:
  1. vuelve a pedir el tablero con `api()`, que renueva la sesión si el acceso venció;
  2. si la sesión terminó, no reabre: el manejador de cierre de sesión existente ya redirige al login;
  3. si no, reabre tras una espera creciente: 1, 2, 4, 8, 16 y 30 s como tope. La espera vuelve a 1 s tras una apertura correcta.
- Depende de `sucursalId` de la sesión: al cambiar de sucursal activa, cierra el flujo y abre otro.
- La lógica de reconexión (cálculo de la espera y transiciones de estado) va en una función pura aparte, para probarla sin navegador.

### 5.2 `TableroPage`

- `refetchInterval` pasa de 15 s a 60 s (D6).
- El texto "Se actualiza cada 15 s" se sustituye por un indicador: punto verde y "En vivo", o punto ámbar y "Reconectando…". Se conserva la hora de la última lectura.
- `PanelHabitacion` no cambia: sigue invalidando las consultas tras su propia mutación, de modo que quien hace el cambio no espera al aviso.

## 6. Errores y casos límite

| Caso | Comportamiento |
|---|---|
| Redis no disponible al publicar | El cambio se guarda, se registra el error, los demás navegadores lo ven en ≤ 60 s |
| Redis se cae con flujos abiertos | Los flujos siguen abiertos (latido incluido); al volver Redis, la suscripción se restablece sola |
| Vence el token con el flujo abierto | El servidor cierra; el cliente renueva y reabre (§5.1) |
| Sesión revocada | No puede renovar; el flujo no se reabre. Recibe avisos 15 min como máximo (D5) |
| Usuario de la sucursal A | Nunca recibe avisos de la sucursal B: el canal sale del token |
| Aviso entre la carga inicial y la apertura del flujo | Cubierto por la invalidación en `open` |
| Ráfaga de avisos | React Query agrupa las invalidaciones de una misma consulta en vuelo; no se añade otro limitador |
| Reinicio o despliegue de la API | El flujo se corta y el cliente reconecta con espera creciente |

## 7. Preparación: estructura de carpetas

El código ya sigue el DT-001 §4.3. Se corrigen las dos diferencias reales, en un commit propio antes del resto:

- `web/src/lib/api.ts` → `web/src/lib/api/` con `cliente.ts` (peticiones y renovación), `tipos.ts` (`Sesion`, `Estado`, `Tablero`…) e `index.ts` que reexporta todo. Los imports `'../lib/api'` existentes no cambian. Sin cambios de comportamiento.
- El árbol de carpetas del README se actualiza: las tres migraciones, `auditoria/`, `common/`, `prisma/` y `lib/api/`.

Los módulos `auditoria/` y `catalogos/`, que el DT-001 no lista, se mantienen: siguen el mismo patrón.

## 8. Pruebas

**Unitarias (API)**
- `aviso-tablero`: nombre del canal y rechazo de mensajes mal formados.
- `flujo-tablero` con temporizadores simulados: convierte avisos en eventos, emite latido y termina al llegar `exp`.
- `avisos-tablero.service` con un notificador falso: publica, no propaga fallos y reparte a todas las sucursales de la empresa.

**Integración (`test:e2e`, MySQL y Redis reales)**
- Dos instancias de la aplicación: un aviso publicado en una llega como evento `tablero` al flujo abierto en la otra.
- Un flujo de la sucursal A no recibe el aviso de un cambio en la sucursal B.
- Sin cookie: 401 y ningún flujo.
- Cada operación de §4.2 publica el aviso esperado; las que no deben publicar no lo hacen, y una operación rechazada tampoco. Los servicios no tienen pruebas unitarias en este repo: se prueban aquí, contra la base real.
- Un fallo del notificador no hace fallar el cambio de estado, y la API arranca y atiende con Redis apagado.
- Mensajes no válidos en el canal se descartan; al cerrar el navegador se libera la suscripción.

**Cliente**
- La lógica de conexión vive en un módulo puro (`conexion-tablero.ts`) con el flujo, el temporizador y la revalidación inyectados, porque el proyecto no tiene DOM de pruebas. Se prueba ahí: secuencia de esperas, reinicio tras una apertura correcta, no reabrir si la sesión terminó, y detener con una reconexión pendiente.
- `useTableroEnVivo` solo conecta ese módulo con `EventSource`, React Query y la visibilidad de la pestaña; se cubre con la verificación manual.

**Integración continua:** el flujo de CI debe levantar Redis para `test:e2e`; se verifica y se añade si falta.

**Verificación manual:** dos navegadores en la misma sucursal; cambiar el estado de una habitación en uno y verlo en el otro en menos de 1 s. Detener Redis, repetir, y comprobar que el cambio aparece dentro de 60 s y que el indicador vuelve a "En vivo" al restablecerlo.
