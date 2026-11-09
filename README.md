# Sistema de Gestión Hotelera con Facturación Electrónica SUNAT

Repositorio único del proyecto descrito en el documento técnico **DT-001**: API en NestJS y cliente web en React, sobre MySQL 8.

| Paquete | Tecnología |
|---|---|
| `api/` | NestJS 11 · TypeScript estricto · Prisma 6 · MySQL 8 · JWT en cookie httpOnly · Argon2id · Swagger |
| `web/` | React 19 · Vite 6 · Tailwind CSS 4 · React Router 7 · TanStack Query |
| Infraestructura | Docker Compose (MySQL 8 + Redis 7) · GitHub Actions |

## Levantar el proyecto

Requisitos: Node 22, pnpm 10 y Docker Desktop abierto.

En Windows basta con hacer doble clic en `iniciar-demo.bat` (hace todo lo de abajo y abre el navegador).

```bash
cp api/.env.example api/.env
pnpm preparar   # instala, levanta MySQL y Redis, aplica migraciones y carga datos de ejemplo
pnpm dev        # API en http://localhost:3000/api · web en http://localhost:5173
```

- Documentación de la API: http://localhost:3000/api/docs
- Usuarios de ejemplo (clave `Hotel2026!`): `admin` (todas las sucursales), `recepcion1` (Hotel Centro), `recepcion2` (Hostal Alto Tacna), `caja1`, `limpieza1`.
- Los datos de empresa, sucursales, habitaciones, huéspedes y tarifas son **de ejemplo**.

Variables de `api/.env` (ver `api/.env.example`):

| Variable | Por defecto | Nota |
|---|---|---|
| `JWT_SECRET` | valor de respaldo en desarrollo | Obligatoria con `NODE_ENV=production`: la API no arranca sin ella |
| `JWT_ACCESO_MIN` | 15 | Minutos de vida del token de acceso (reemplaza a `JWT_EXPIRES_IN`, eliminada) |
| `SESION_MAX_HORAS` | 12 | Duración máxima de una sesión |
| `REFRESH_GRACIA_SEG` | 30 | Tolerancia para reusar un token de renovación recién rotado |
| `TRUST_PROXY` | `false` | Número de proxies de confianza: `1` detrás de Nginx o Caddy. `true` no se admite (la IP del cliente saldría de `X-Forwarded-For`, que él controla) |
| `LIMITE_AUTH_POR_MIN` | 10 | Límite por IP en login y renovación |

Otros comandos: `pnpm test` (pruebas), `pnpm --filter api test:e2e` (pruebas de integración de la API; requieren MySQL con migraciones y datos de ejemplo), `pnpm typecheck`, `pnpm build`, `pnpm infra:down`.

## Estructura

```
api/
  prisma/
    migrations/20261104000000_esquema_inicial/   Esquema v1.1 completo: 54 tablas, CHECK, triggers, procedimientos, vistas, catálogos SUNAT
    schema.prisma                                Generado desde la BD (scripts/gen-prisma-schema.py)
    seed.ts                                      Datos de ejemplo
  src/
    main.ts · worker.ts                          Arranque en modo API y en modo trabajador
    modules/
      auth/            Login, cookie de sesión, guard global de permisos (@RequierePermiso)
      organizacion/    Empresa, sucursales, usuarios y roles
      catalogos/       Catálogos SUNAT y tipos de movimiento
      hospedaje/
        domain/          Máquina de estados de la habitación, turnos, alertas (lógica pura + pruebas)
        application/     Casos de uso
        infrastructure/  Repositorio Prisma (filtra por sucursal del token)
      facturacion/
        domain/          Puerto ProveedorFacturacion
        infrastructure/pse/  Adaptador simulado (NubeFacT / FactuSmart irán aquí)
web/
  src/pages/          Login, tablero, reservas (maqueta), usuarios y roles, hotel y tarifas, cambio de contraseña
  src/features/       Sesión y lógica de hospedaje
  src/components/ui/  Componentes base
```

## Avance (semana 2 · al 9 de noviembre)

| Sprint (DT-001) | Alcance | Estado |
|---|---|---|
| S-01 Preparación | Repositorio único, Docker, NestJS, React + Vite, Prisma, migración del esquema, catálogos SUNAT, CI | **Completo** |
| S-02 Seguridad | Login con JWT en cookie httpOnly y Argon2id, bloqueo tras 3 intentos, guard de permisos por rol. Sesiones revocables: token de acceso de 15 min y token de renovación rotativo (sesión máxima de 12 h); un secreto de renovación desconocido se rechaza sin revocar nada, y reusar el token anterior pasados 30 s revoca la sesión. Cierre por inactividad configurable por empresa (15 a 480 min, 30 por defecto) con aviso de 60 s sincronizado entre pestañas. Bitácora de auditoría inmutable (triggers) con códigos `modulo.accion`, que registra sesión y alta de habitaciones. Límite de 10 por minuto por IP en login y renovación | **Completo** |
| S-03 Usuarios y roles | Alta con contraseña temporal (obligatorio cambiarla al primer ingreso), edición de datos, rol y sucursales con principal, activar/desactivar, desbloquear, restablecer contraseña y cerrar sesiones. Desactivar o cambiar rol/sucursales cierra las sesiones del usuario. Roles nuevos y matriz de permisos editable (ADMINISTRADOR protegido). Cambio de la propia contraseña. Todo auditado | **Completo** (series por usuario pasan a S-08 y certificado digital a S-09) |
| S-04 Configuración del hotel | Pantalla *Hotel y tarifas*: habitaciones (alta, edición, desactivar si no está ocupada), pisos, tipos de habitación y tarifas por tipo × canal × turno con vigencia. Un precio nuevo se programa con fecha y cierra el anterior el día previo; historial por celda. API de precio vigente lista para reservas | **Completo** |
| S-05 Tablero | Tablero por piso con colores, cambio de estado con reglas y historial, alertas de salida | **Adelantado** (falta tiempo real con WebSocket) |
| S-06 Reservas | Maqueta del calendario y del formulario de reserva para validar con recepción | **Maqueta** |
| F3 Facturación | Puerto del proveedor y adaptador simulado | **Diseño listo** |

Requerimientos cubiertos o iniciados: RF-SEG-01 a 05; RF-RES-01 a 05, 08 y 15 (API); RNF-12, 13, 14, 15, 16, 19 (bloqueo de serie ya en BD), 27, 30, 32, 34.

Pruebas: 88 unitarias de API, 35 de integración contra MySQL real (`pnpm --filter api test:e2e`) y 29 del cliente.

### Qué mostrar de la semana 2

1. **Usuarios y roles** (como `admin`): *+ Nuevo usuario* → la contraseña temporal se genera sola. Cerrar sesión e ingresar con ese usuario: pide crear su contraseña antes de mostrar el menú.
2. En otra ventana, iniciar sesión como `recepcion1`; como `admin`, menú **⋯ → Desactivar**. La sesión de `recepcion1` termina con el aviso "Tu usuario fue desactivado" cuando vence su acceso (15 min como máximo; ya no puede renovarlo ni volver a ingresar).
3. **Roles y permisos**: quitarle un permiso a RECEPCIONISTA y guardar.
4. **Hotel y tarifas → Tarifas**: clic en una celda, programar un precio con fecha futura. La celda muestra el cambio programado; con *Ver precios al* en esa fecha se ve el precio nuevo.
5. **Habitaciones**: agregar la 109 al piso 1 y verla en el tablero; intentar desactivar una ocupada (el sistema lo impide).

## Decisiones técnicas de esta semana

- **El esquema SQL es la fuente de verdad.** La migración inicial es el script v1.1 completo (triggers, procedimientos, vistas y CHECK que Prisma no modela). `schema.prisma` se genera desde la base con `python3 api/scripts/gen-prisma-schema.py hotel_dev` (equivalente a `prisma db pull`). Cambios futuros: nueva migración SQL y volver a generar. Sin cliente mysql local (p. ej. Windows con Docker): `MYSQL_CMD="docker exec -i hotel-mysql mysql -uroot -proot_dev_pass" python api/scripts/gen-prisma-schema.py hotel_dev`; `MYSQL_CMD` admite cualquier comando de cliente mysql.
- **Prisma sin binarios nativos.** Se usa `engineType = "client"` con el adaptador `@prisma/adapter-mariadb` (compatible con MySQL 8). La imagen Docker queda más liviana y no depende de descargar el motor de Prisma.
- **Fechas en UTC en la base**, mostradas en hora de Lima en la interfaz.
- **`argon2` fijado en 0.44.** El binario de 0.45.x para Windows falla al cargar; no subir de versión sin probar en Windows.
- **La sucursal activa sale del token**, nunca de un parámetro del navegador (DT-001 §4.4).

## Próximos pasos

1. Tablero en vivo con WebSocket (S-05).
2. Reservas y check-in reales sobre la maqueta validada, usando el precio vigente de `GET /hospedaje/tarifas/vigente` (S-06).
3. Series por usuario cuando existan series operativas (S-08).
4. Pendiente de gerencia para F3: elegir proveedor (NubeFacT o FactuSmart) y volumen mensual de comprobantes (A-01, A-03).
