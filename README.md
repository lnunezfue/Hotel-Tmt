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

Para levantar una segunda copia junto a otra ya abierta: la API con `PORT=3100` y el cliente con `API_URL=http://localhost:3100 vite --port 5273` (el proxy de Vite apunta a `API_URL`, por defecto `http://localhost:3000`).

Otros comandos: `pnpm test` (pruebas), `pnpm --filter api test:e2e` (pruebas de integración de la API; requieren MySQL con migraciones y datos de ejemplo), `pnpm typecheck`, `pnpm build`, `pnpm infra:down`.

## Estructura

```
api/
  prisma/
    migrations/
      20261104000000_esquema_inicial/            Esquema v1.1 completo: 54 tablas, CHECK, triggers, procedimientos, vistas, catálogos SUNAT
      20261105000000_sesiones_y_auditoria/       Sesiones revocables, inactividad por empresa, bitácora inmutable (S-02)
      20261109000000_usuarios_y_configuracion/   Contraseña temporal y permisos de usuarios y configuración (S-03/S-04)
      20261124000000_reservas_y_estancias/       Comisión congelada, responsable de anulaciones, solapes tras el check-in, permiso de clientes (S-06)
    schema.prisma                                Generado desde la BD (scripts/gen-prisma-schema.py)
    seed.ts                                      Datos de ejemplo
  src/
    main.ts · worker.ts                          Arranque en modo API y en modo trabajador
    app.module.ts                                Composición de módulos
    config.ts                                    Configuración validada (JWT, proxy, Redis)
    common/                                      Contexto de petición, decorador del usuario, validación con Zod
    prisma/                                      Servicio de Prisma
    modules/
      auth/            Login, sesiones revocables, guard global de permisos (@RequierePermiso)
      auditoria/       Bitácora inmutable y verificación de @Auditar
      organizacion/    Empresa, sucursales, usuarios y roles
      catalogos/       Catálogos SUNAT y tipos de movimiento
      hospedaje/
        domain/          Estados de la habitación, tarifas, clientes, reservas, estancias y aviso del tablero (lógica pura + pruebas)
        application/     Casos de uso (configuración, clientes, reservas, estancias), disponibilidad, flujo y avisos del tablero
        infrastructure/  Repositorio Prisma (filtra por sucursal del token) y notificador Redis
        reservas.controller.ts          Clientes, reservas, check-in, extensión, check-out y libro de huéspedes
        tablero-eventos.controller.ts   Flujo SSE del tablero en vivo
      facturacion/
        domain/          Puerto ProveedorFacturacion
        infrastructure/pse/  Adaptador simulado (NubeFacT / FactuSmart irán aquí)
  test/                Pruebas de integración contra MySQL y Redis reales
web/
  src/pages/          Login, tablero, reservas (calendario y libro de huéspedes), clientes, usuarios y roles, hotel y tarifas, cambio de contraseña
  src/features/       Lógica por dominio: sesión e inactividad, hospedaje (conexión en vivo, reservas y fechas de Lima), organización
  src/components/     Componentes base (ui/) y de hospedaje: formulario y buscador de clientes, check-in y estancia
  src/lib/api/        Cliente HTTP tipado y tipos compartidos
```

## Avance (al 24 de noviembre)

| Sprint (DT-001) | Alcance | Estado |
|---|---|---|
| S-01 Preparación | Repositorio único, Docker, NestJS, React + Vite, Prisma, migración del esquema, catálogos SUNAT, CI | **Completo** |
| S-02 Seguridad | Login con JWT en cookie httpOnly y Argon2id, bloqueo tras 3 intentos, guard de permisos por rol. Sesiones revocables: token de acceso de 15 min y token de renovación rotativo (sesión máxima de 12 h); un secreto de renovación desconocido se rechaza sin revocar nada, y reusar el token anterior pasados 30 s revoca la sesión. Cierre por inactividad configurable por empresa (15 a 480 min, 30 por defecto) con aviso de 60 s sincronizado entre pestañas. Bitácora de auditoría inmutable (triggers) con códigos `modulo.accion`, que registra sesión y alta de habitaciones. Límite de 10 por minuto por IP en login y renovación | **Completo** |
| S-03 Usuarios y roles | Alta con contraseña temporal (obligatorio cambiarla al primer ingreso), edición de datos, rol y sucursales con principal, activar/desactivar, desbloquear, restablecer contraseña y cerrar sesiones. Desactivar o cambiar rol/sucursales cierra las sesiones del usuario. Roles nuevos y matriz de permisos editable (ADMINISTRADOR protegido). Cambio de la propia contraseña. Todo auditado | **Completo** (series por usuario pasan a S-08 y certificado digital a S-09) |
| S-04 Configuración del hotel | Pantalla *Hotel y tarifas*: habitaciones (alta, edición, desactivar si no está ocupada), pisos, tipos de habitación y tarifas por tipo × canal × turno con vigencia. Un precio nuevo se programa con fecha y cierra el anterior el día previo; historial por celda. API de precio vigente lista para reservas | **Completo** |
| S-05 Tablero en vivo, canales y turnos | Tablero por piso con colores, cambio de estado con reglas y historial, alertas de salida. Los cambios de estado, habitaciones, pisos y tipos llegan a los demás tableros de la sucursal sin recargar (Server-Sent Events, repartidos entre réplicas con Redis), con indicador *En vivo* y consulta de respaldo cada 60 s. Pestaña *Canales*: alta, edición y desactivación de canales de venta con su comisión (permiso `tarifa.editar`; no se desactiva el último activo). Pestaña *Turnos*: alta, edición y desactivación de turnos; la duración no se cambia si el turno ya tiene tarifas o estancias | **Completo** (probado a mano con dos sesiones y con Redis apagado) |
| S-06 Clientes, reservas y estancias | *Clientes*: alta y edición con validación por tipo de documento (DNI, CE, pasaporte, RUC con dígito verificador); el documento no cambia si ya tiene reservas o estancias. *Reservas*: calendario de 14 días por habitación, reserva de una o varias habitaciones con el precio vigente y la comisión del canal congelados, confirmar, anular y no-show con motivo y responsable. Nadie puede tomar una habitación que se cruza con otra reserva o estancia, ni dos recepcionistas a la vez. *Check-in* desde la reserva o sin ella (walk-in), con titular, acompañantes, capacidad y datos del libro de huéspedes; *extensión* por turnos; *check-out* con liquidación (un turno más si se sale pasados 30 min). La habitación se ocupa y se libera sola, y el tablero muestra las llegadas del día | **Completo** (el cobro y el comprobante llegan con F3) |
| F3 Facturación | Puerto del proveedor y adaptador simulado | **Diseño listo** |

Requerimientos cubiertos o iniciados: RF-SEG-01 a 05; RF-RES-01 a 13 y 15 a 18; RNF-12, 13, 14, 15, 16, 19 (bloqueo de serie ya en BD), 24, 27, 30, 32, 34.

Pruebas: 175 unitarias de API, 93 de integración contra MySQL y Redis reales (`pnpm --filter api test:e2e`, con `pnpm infra:up` antes) y 59 del cliente.

### Qué mostrar de la semana 2

1. **Usuarios y roles** (como `admin`): *+ Nuevo usuario* → la contraseña temporal se genera sola. Cerrar sesión e ingresar con ese usuario: pide crear su contraseña antes de mostrar el menú.
2. En otra ventana, iniciar sesión como `recepcion1`; como `admin`, menú **⋯ → Desactivar**. La sesión de `recepcion1` termina con el aviso "Tu usuario fue desactivado" cuando vence su acceso (15 min como máximo; ya no puede renovarlo ni volver a ingresar).
3. **Roles y permisos**: quitarle un permiso a RECEPCIONISTA y guardar.
4. **Hotel y tarifas → Tarifas**: clic en una celda, programar un precio con fecha futura. La celda muestra el cambio programado; con *Ver precios al* en esa fecha se ve el precio nuevo.
5. **Habitaciones**: agregar la 109 al piso 1 y verla en el tablero; intentar desactivar una ocupada (el sistema lo impide).

### Qué mostrar del S-06

1. **Reservas** (como `recepcion1`): clic en un día libre del calendario → titular, noches y habitaciones con su precio → *Registrar reserva*. Intentar reservar la misma habitación en esas fechas: el sistema lo impide.
2. **Tablero**: una habitación libre → *Check-in sin reserva* → registrar al huésped ahí mismo con *+ Registrar cliente nuevo*. La habitación pasa a *Ocupada* en todos los tableros abiertos.
3. En esa habitación: *Extender* un turno y luego *Hacer check-out*; se ve la liquidación y la habitación pasa a *Limpieza*.
4. **Reservas → Libro de huéspedes**: el ingreso queda registrado con procedencia y motivo del viaje.

Las reservas de ejemplo del calendario las carga `pnpm db:seed` sobre una base vacía. Una base anterior al S-06 solo recibe la migración: sus reservas se crean desde la pantalla.

## Decisiones técnicas de esta semana

- **El esquema SQL es la fuente de verdad.** La migración inicial es el script v1.1 completo (triggers, procedimientos, vistas y CHECK que Prisma no modela). `schema.prisma` se genera desde la base con `python3 api/scripts/gen-prisma-schema.py hotel_dev` (equivalente a `prisma db pull`). Cambios futuros: nueva migración SQL y volver a generar. Sin cliente mysql local (p. ej. Windows con Docker): `MYSQL_CMD="docker exec -i hotel-mysql mysql -uroot -proot_dev_pass" python api/scripts/gen-prisma-schema.py hotel_dev`; `MYSQL_CMD` admite cualquier comando de cliente mysql.
- **Prisma sin binarios nativos.** Se usa `engineType = "client"` con el adaptador `@prisma/adapter-mariadb` (compatible con MySQL 8). La imagen Docker queda más liviana y no depende de descargar el motor de Prisma.
- **Fechas en UTC en la base**, mostradas en hora de Lima en la interfaz.
- **`argon2` fijado en 0.44.** El binario de 0.45.x para Windows falla al cargar; no subir de versión sin probar en Windows.
- **La sucursal activa sale del token**, nunca de un parámetro del navegador (DT-001 §4.4).
- **El estado de la habitación no cambia al reservar** (S-06): el tablero muestra el estado de ahora y, aparte, la llegada de hoy. La habitación pasa a *Ocupada* solo con el check-in y sale de ahí solo con el check-out. Detalle en `docs/superpowers/specs/2026-11-24-s06-ciclo-hospedaje-design.md`.
- **Tablero en vivo con Server-Sent Events, no WebSocket.** El tablero solo necesita avisos del servidor al navegador; SSE reutiliza la cookie y el guard existentes, mientras que WebSocket exigiría otra ruta de autenticación sobre las sesiones revocables. El aviso no lleva datos: el navegador vuelve a pedir el tablero. Redis reparte los avisos entre réplicas (`REDIS_URL`, obligatoria en producción). Detalle en `docs/superpowers/specs/2026-11-09-s05-tablero-en-vivo-design.md`.

## Próximos pasos

1. Editar una reserva (fechas y habitaciones) sin anularla; hoy se anula y se crea otra.
2. Traslado de huésped a otra habitación (RF-RES-14).
3. Cobro del check-out y comprobante del hospedaje con el importe que ya guarda la estancia (S-07 y S-08).
4. Series por usuario cuando existan series operativas (S-08).
5. Pendiente de gerencia para F3: elegir proveedor (NubeFacT o FactuSmart) y volumen mensual de comprobantes (A-01, A-03), y el tratamiento de los adelantos de reserva (A-07).
