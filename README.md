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
    migrations/
      20261104000000_esquema_inicial/            Esquema v1.1 completo: 54 tablas, CHECK, triggers, procedimientos, vistas, catálogos SUNAT
      20261105000000_sesiones_y_auditoria/       Sesiones revocables, inactividad por empresa, bitácora inmutable (S-02)
      20261109000000_usuarios_y_configuracion/   Contraseña temporal y permisos de usuarios y configuración (S-03/S-04)
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
        domain/          Estados de la habitación, tarifas, aviso del tablero y su puerto (lógica pura + pruebas)
        application/     Casos de uso, flujo de eventos y avisos del tablero
        infrastructure/  Repositorio Prisma (filtra por sucursal del token) y notificador Redis
        tablero-eventos.controller.ts   Flujo SSE del tablero en vivo
      facturacion/
        domain/          Puerto ProveedorFacturacion
        infrastructure/pse/  Adaptador simulado (NubeFacT / FactuSmart irán aquí)
  test/                Pruebas de integración contra MySQL y Redis reales
web/
  src/pages/          Login, tablero, plano del hotel, reservas, usuarios y roles, hotel y tarifas, cambio de contraseña
  src/demo/           API simulada para la demostración web (solo con VITE_DEMO=1)
  src/features/       Lógica por dominio: sesión e inactividad, hospedaje (incluida la conexión en vivo), organización
  src/components/ui/  Componentes base
  src/lib/api/        Cliente HTTP tipado y tipos compartidos
```

## Avance (semana 4 · al 26 de noviembre)

| Sprint (DT-001) | Alcance | Estado |
|---|---|---|
| S-01 Preparación | Repositorio único, Docker, NestJS, React + Vite, Prisma, migración del esquema, catálogos SUNAT, CI | **Completo** |
| S-02 Seguridad | Login con JWT en cookie httpOnly y Argon2id, bloqueo tras 3 intentos, guard de permisos por rol. Sesiones revocables: token de acceso de 15 min y token de renovación rotativo (sesión máxima de 12 h); un secreto de renovación desconocido se rechaza sin revocar nada, y reusar el token anterior pasados 30 s revoca la sesión. Cierre por inactividad configurable por empresa (15 a 480 min, 30 por defecto) con aviso de 60 s sincronizado entre pestañas. Bitácora de auditoría inmutable (triggers) con códigos `modulo.accion`, que registra sesión y alta de habitaciones. Límite de 10 por minuto por IP en login y renovación | **Completo** |
| S-03 Usuarios y roles | Alta con contraseña temporal (obligatorio cambiarla al primer ingreso), edición de datos, rol y sucursales con principal, activar/desactivar, desbloquear, restablecer contraseña y cerrar sesiones. Desactivar o cambiar rol/sucursales cierra las sesiones del usuario. Roles nuevos y matriz de permisos editable (ADMINISTRADOR protegido). Cambio de la propia contraseña. Todo auditado | **Completo** (series por usuario pasan a S-08 y certificado digital a S-09) |
| S-04 Configuración del hotel | Pantalla *Hotel y tarifas*: habitaciones (alta, edición, desactivar si no está ocupada), pisos, tipos de habitación y tarifas por tipo × canal × turno con vigencia. Un precio nuevo se programa con fecha y cierra el anterior el día previo; historial por celda. API de precio vigente lista para reservas | **Completo** |
| S-05 Tablero en vivo, canales y turnos | Tablero por piso con colores, cambio de estado con reglas y historial, alertas de salida. Los cambios de estado, habitaciones, pisos y tipos llegan a los demás tableros de la sucursal sin recargar (Server-Sent Events, repartidos entre réplicas con Redis), con indicador *En vivo* y consulta de respaldo cada 60 s. Pestaña *Canales*: alta, edición y desactivación de canales de venta con su comisión (permiso `tarifa.editar`; no se desactiva el último activo). Pestaña *Turnos*: alta, edición y desactivación de turnos; la duración no se cambia si el turno ya tiene tarifas o estancias | **Completo** (probado a mano con dos sesiones y con Redis apagado) |
| S-06 Plano del hotel y comodidades | Pantalla *Plano del hotel*: fachada del edificio con un piso por banda y ventanas del color de cada estado; plano de cada piso con las habitaciones dibujadas desde arriba (camas según el tipo, baño, puerta hacia el pasillo, ventana) y sus íconos de comodidades. Modo *Diseñar*: agregar un piso con vista previa, agregar habitaciones, pasillos, escaleras, ascensor, recepción y áreas comunes, arrastrar y redimensionar con validación de choques. Comodidades por habitación (aire acondicionado, wifi, TV, jacuzzi…, 12 de partida y se pueden crear más) o para todas las de un tipo | **Completo** (pedido de gerencia del 23/11) |
| S-06 Reservas y check-in | Calendario de 14 días por habitación, llegadas y salidas de hoy, reserva con búsqueda o alta de huésped (DNI, RUC con dígito verificador, CE, pasaporte), habitación libre y precio de la tarifa vigente; el sistema impide fechas que se cruzan. Confirmar, cancelar con motivo, «no se presentó» y check-in que crea la estancia y ocupa la habitación. También se reserva haciendo clic en una habitación libre del plano, filtrando por comodidades | **Completo** |
| S-07 Estadía, cobro y caja | Reservas de varias habitaciones con adelanto (entra a caja) y comisión del canal fijada al reservar; check-in con acompañantes por habitación; check-in directo sin reserva (por noche o por horas); consumos del frigobar y servicios; check-out con cuenta (hospedaje + consumos − adelanto), pago dividido con vuelto en efectivo, boleta, factura o nota interna con IGV y ticket imprimible, habitaciones a limpieza. Caja: apertura, gastos y retiros, cierre con arqueo (faltante o sobrante) | **Completo** (el envío a SUNAT es F3) |
| S-06/S-07 Complementos de la estadía | Extensión por turnos al precio pactado y traslado a otra habitación con motivo (la que se deja pasa a limpieza). La cuenta cobra los turnos consumidos si se sale pasados 30 min de la salida prevista. Destino y motivo del viaje en el check-in y pantalla *Libro de huéspedes*. Cancelar y «no se presentó» guardan motivo y responsable. Pantalla *Clientes* con ficha editable (el documento no cambia si ya tiene historia) y permiso `cliente.gestionar` para caja. Reservas y walk-in se cruzan contra estadías y reservas con la habitación bloqueada; un huésped no se aloja dos veces y una empresa no se aloja. Turnos de cualquier duración | **Completo** (spec `2026-11-25-estadia-complementos-design.md`) |
| S-07 Series, totales y descuento global | Pantalla *Series de comprobantes*: series por sucursal con el prefijo de SUNAT (F, B, I; F/B en notas), número inicial para continuar otro sistema, activar o desactivar sin dejar un tipo de venta sin serie. Series asignadas a usuarios: cada caja numera con la suya; quien no tiene una usa una compartida. Check-out con descuento global en soles o % (motivo y permiso `descuento.aplicar`), restado de la base y del IGV sin tocar las líneas; boleta a nombre de otra persona y boleta de más de S/ 700 solo con comprador identificado. Estructura del comprobante para el proveedor (`GET /comprobantes/:id/estructura`) verificada. Correlativo probado con 20 emisiones simultáneas sin saltos | **Completo** (spec `2026-11-25-s07-comprobantes-design.md`) |
| Operación real del hotel | Con el plano y la información del cuartelero: *Hotel Centro* del seed es el local real de 2 niveles (13 matrimoniales y 1 doble). Pestaña *Operación* por sucursal: cobro al ingreso, venta de consumos, minutos de limpieza, salida de la noche (9:00), turno sugerido (4 h) y hora máxima de salida según la hora del check-in (madrugada → 12:00, mañana → 18:00, tarde y noche → 6:00 del día siguiente). El check-in cobra por adelantado (efectivo, Culqi u otros) y muestra a qué hora sale; no vende horas que pasen la hora máxima; la extensión cobra la diferencia; el check-out de una cuenta pagada solo cierra. El tablero cuenta el tiempo de limpieza y avisa las demoradas. Reservas sin adelanto: el tiempo corre desde que llegan | **Completo** (spec `2026-11-26-operacion-real-design.md`; reglas a confirmar con el hotel) |
| F3 Facturación (S-08 en adelante) | Puerto del proveedor y adaptador simulado; envío a SUNAT, notas de crédito y débito, resumen diario y baja | **Pendiente** |

Requerimientos cubiertos o iniciados: RF-SEG-01 a 05; RF-RES-01 a 18; RNF-12, 13, 14, 15, 16, 19 (bloqueo de serie ya en BD), 27, 30, 32, 34.

Pruebas: 222 unitarias de API, 121 de integración contra MySQL y Redis reales (`pnpm --filter api test:e2e`, con `pnpm infra:up` antes) y 64 del cliente.

**Demostración web** (sin instalar nada, publicada en https://lnunezfue.github.io/Hotel-Tmt/ desde la rama `gh-pages`): `pnpm --filter web build:demo` genera en `web/dist-demo` el cliente con una API simulada en el navegador, cargada con una foto del seed. Entra con `admin` o `recepcion1` (`Hotel2026!`); los cambios quedan solo en ese navegador y *Reiniciar demo* vuelve al inicio. El build normal no la incluye. Trae un **recorrido guiado** de 7 pasos con el día de recepción del hotel real: abrir caja → check-in por horas con pago adelantado (efectivo o Culqi) → extender y cobrar la diferencia → check-out sin cobro → limpieza de 30 min → reserva que no llegó → cierre de caja. La foto se vuelve a tomar con `node web/scripts/capturar-demo.mjs` (API en marcha y base recién sembrada).

### Qué mostrar de la operación real

1. **Plano del hotel**: los 2 niveles del local (garaje, recepción, sala-comedor, patio, SS.HH. y las 14 habitaciones).
2. Clic en una libre → **Check-in directo**: propone 4 horas, dice a qué hora sale y la hora máxima de su franja; cobra por adelantado (efectivo con vuelto o Culqi con n.º de operación) y emite la boleta.
3. Elegir 2 turnos de 12 h: el sistema avisa que pasa la hora máxima y cuántos turnos caben.
4. **Tablero** → la habitación → *Ver estadía* → *Extender estadía* → *Cobrar* la diferencia. Luego *Check-out · la cuenta está pagada*: no emite otro comprobante.
5. El tablero muestra «Limpiando hace N min»; la 103 ya pasó los 30 y sale *Limpieza demorada*.
6. **Reservas** → la 202 de hoy no llegó → *No se presentó*.
7. **Hotel y tarifas → Operación**: cambiar las horas o el tiempo de limpieza sin tocar código.

### Qué mostrar de la semana 4

1. **Plano del hotel → Ver estado**: el edificio muestra la ocupación de cada piso. Clic en la 101: dibujo, estado, huésped y comodidades.
2. **Diseñar plano → + Agregar piso**: elegir 6 habitaciones Doble; la vista previa se arma sola y el piso «cae» sobre el edificio. Arrastrar una habitación, agregar un ascensor, guardar.
3. Clic en una habitación → marcar *Jacuzzi* y *Aplicar a todas las Doble* → el dibujo cambia.
4. **Reservar**: fecha de mañana, filtrar por aire acondicionado, clic en una libre → buscar huésped o registrarlo → el precio sale de la tarifa → registrar.
5. **Reservas**: la reserva aparece en el calendario; abrir una de las que *llegan hoy* → *Hacer check-in* → la habitación pasa a OCUPADA en el tablero y en el plano.
6. Intentar reservar la misma habitación en fechas que se cruzan: el sistema lo impide.

### Qué mostrar del S-07

1. **Series de comprobantes** (como `admin`): *+ Nueva serie* B002 → *Editar* → asignarla a `recepcion1`. Desde ahí `recepcion1` emite sus boletas con B002 y los demás siguen con B001.
2. **Check-out** de una habitación ocupada: se ve con qué número saldrá («Se emitirá como B001-…»). Marcar *Descuento global*, S/ 20 con motivo: el saldo baja y el ticket muestra el descuento aparte, con la base y el IGV recalculados.
3. Intentar una serie `F001` como boleta o un descuento mayor que el saldo de una reserva con adelanto: el sistema lo impide.

### Qué mostrar de los complementos

1. **Tablero** → una habitación ocupada → *Ver cuenta*: *Extender estadía* un turno (sube la salida y la cuenta) y *Cambiar de habitación* con un motivo: la anterior queda en limpieza.
2. **Reservas** → una llegada de hoy → el check-in pide procedencia, destino y motivo del viaje; después se ve en **Libro de huéspedes**.
3. *No se presentó…* pide el motivo y deja registrado quién lo marcó.
4. **Clientes**: buscar, editar la ficha; intentar cambiar el DNI de alguien que ya se alojó (el sistema lo impide).

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
- **Tablero en vivo con Server-Sent Events, no WebSocket.** El tablero solo necesita avisos del servidor al navegador; SSE reutiliza la cookie y el guard existentes, mientras que WebSocket exigiría otra ruta de autenticación sobre las sesiones revocables. El aviso no lleva datos: el navegador vuelve a pedir el tablero. Redis reparte los avisos entre réplicas (`REDIS_URL`, obligatoria en producción). Detalle en `docs/superpowers/specs/2026-11-09-s05-tablero-en-vivo-design.md`.

## Próximos pasos

1. Confirmar con el hotel la salida de la noche (9:00) frente a la hora máxima de 6:00 para quien entra en la tarde o noche, y los precios reales por turno (spec de la operación real, §7).
1. Revisar con recepción la regla D10 del S-06: una reserva hecha antes para hoy no pinta la habitación de reservada hasta que alguien la toque.
2. `build:demo` usa `VITE_DEMO=1 …`, que no funciona en la consola de Windows; en Windows se corre desde Git Bash.
3. S-08: adaptador del proveedor, cola y trabajador, envío al ambiente beta y CDR, usando `GET /comprobantes/:id/estructura` como entrada.
4. Notas de crédito y débito, resumen diario y comunicación de baja (S-09).
5. Pendiente de gerencia para F3: elegir proveedor (NubeFacT o FactuSmart) y volumen mensual de comprobantes (A-01, A-03).
