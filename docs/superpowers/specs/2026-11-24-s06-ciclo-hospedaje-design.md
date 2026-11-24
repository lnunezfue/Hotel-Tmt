# S-06 — Clientes, reservas, check-in, check-out y extensión

| | |
|---|---|
| Sprint | S-06 (F2) del DT-001, semanas 11–12 |
| Fecha | 2026-11-24 |
| Estado | En implementación en la rama `s06-reservas` (sale de `s05-tablero-en-vivo`, que aún no está en `main`) |
| Requerimientos | RF-RES-06 reservas · RF-RES-10 check-in y walk-in · RF-RES-11 libro de huéspedes · RF-RES-12 check-out · RF-RES-13 extensión · RF-RES-16 anular y no-show · RF-RES-17 clientes · RF-RES-18 sin solapes |
| Resultado verificable (DT-001 §7.2) | Se completa el ciclo de hospedaje de principio a fin |

El usuario pidió avanzar con decisiones propias, como en los turnos. Todo lo marcado *(decisión)* es de Claude y queda abierto a corrección.

## Objetivo

Que recepción opere una estancia completa desde el sistema: registra al cliente, reserva una o varias habitaciones con el precio vigente, hace el check-in (de una reserva o sin ella), anota a los huéspedes, extiende la estancia si hace falta y hace el check-out con el importe calculado. La habitación cambia sola de estado y el tablero lo refleja en vivo.

## Alcance

**Dentro:** clientes, reservas (crear, confirmar, anular, no-show), calendario, check-in desde reserva y walk-in, huéspedes y libro de huéspedes, extensión, check-out con liquidación, cambios de estado automáticos y aviso al tablero, auditoría, pruebas.

**Fuera:**
- **Cobro.** No hay caja (S-11) ni comprobantes (S-07/S-08). El check-out calcula y guarda el importe; cobrarlo y emitir el comprobante llegan en esas fases. Por eso tampoco se registran adelantos (`monto_adelanto` queda en 0; su tratamiento contable es la pregunta A-07).
- **Editar una reserva** (fechas, habitaciones): se anula y se crea otra. *(decisión: mantiene el alcance; es el primer candidato del siguiente sprint si recepción lo pide)*.
- **Traslado de habitación** (RF-RES-14, prioridad media): no figura en el alcance del S-06 del DT-001.
- **Descuentos o precio manual:** el precio sale siempre de la tarifa vigente. Los descuentos son del S-07 (descuento global).
- **Consulta de DNI/RUC en RENIEC/SUNAT:** es del S-10.

## Enfoques considerados

1. **Módulo de hospedaje ampliado** *(elegido)*: servicios nuevos (`ClientesService`, `ReservasService`, `EstanciasService`) y controladores en `modules/hospedaje`, con reglas puras en `domain/`. Es el patrón de S-04 y S-05, y reserva, estancia y habitación comparten transacciones (la habitación se bloquea mientras se reserva o se hace el check-in).
2. Un módulo `clientes` aparte en `organizacion`: los clientes también servirán para facturar, pero hoy solo los usa hospedaje. Se separan cuando llegue facturación si hace falta.
3. Toda la lógica en procedimientos almacenados: el esquema ya tiene triggers de solape, pero las reglas de estado, precio y huéspedes se prueban mejor en TypeScript.

## Cambios de esquema (migración `20261124000000_reservas_y_estancias`)

- `reserva.comision_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0`: copia de la comisión del canal al reservar. Cambiarla después en el canal no altera reportes.
- `reserva.usuario_cancelacion_id` (FK a usuario) y `reserva.cancelada_at`: quién y cuándo anuló o marcó no-show (RF-RES-16); el motivo ya tiene columna.
- `estancia.comision_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0`: la de la reserva o, en un walk-in, la del canal. Así los reportes leen la comisión de un solo lugar.
- Triggers `trg_rh_bi_solape` y `trg_rh_bu_solape` redefinidos: una `reserva_habitacion` que ya tiene estancia deja de bloquear por su rango reservado. Desde el check-in bloquea la estancia (que puede terminar antes o extenderse). Sin esto, una salida anticipada dejaría la habitación bloqueada hasta la fecha reservada.
- Permiso nuevo `cliente.gestionar` (módulo RESERVAS). Se asigna a ADMINISTRADOR, RECEPCIONISTA y CAJERO (el cajero facturará a clientes). Los permisos `reserva.*` y `estancia.*` existentes se asignan también a RECEPCIONISTA en la migración (hoy solo los da el seed).

`schema.prisma` se vuelve a generar desde la base.

## Reglas de dominio

### Clientes (RF-RES-17)

| Tipo (Cat. 06) | Número | Nombre obligatorio |
|---|---|---|
| DNI (1) | 8 dígitos | nombres y apellidos |
| RUC (6) | 11 dígitos, prefijo 10, 15, 16, 17 o 20 y dígito verificador (módulo 11) | razón social |
| CE (4), PAS (7) | 6 a 12 letras o dígitos, en mayúsculas | nombres y apellidos |
| CDI (A) | 6 a 15 letras o dígitos | nombres y apellidos |
| SIN DOC (0) | no se usa en hospedaje: un huésped debe identificarse | — |

- Documento repetido en la empresa → 409.
- Correo con formato válido si se da; teléfono de 6 a 20 caracteres de dígitos, espacios, `+` y `-`.
- Cambiar el tipo o el número de un cliente que ya tiene reservas o estancias → 409 (los documentos ya emitidos lo citan). *(decisión)*
- Se desactiva, no se borra. Un cliente inactivo no se usa en reservas ni estancias nuevas.
- Un **huésped** debe ser persona (no RUC). El **titular de una reserva** puede ser una empresa con RUC (convenio corporativo).

### Tiempos y precio

- La salida se calcula con el turno: `salida = entrada + horas del turno × cantidad`. Se usa con cualquier duración de turno de 1 a 24 h (ya no solo 3, 6, 12 y 24).
- El precio es el de la tarifa vigente el día de la entrada (hora de Lima) para tipo × canal × turno, y se congela en `reserva_habitacion.precio_unitario` con su `tarifa_id`. Sin tarifa vigente → 409 con el nombre de la combinación que falta.
- Moneda PEN.

### Disponibilidad (RF-RES-18)

Una habitación está libre en `[entrada, salida)` si está activa y no se cruza con:
- una `reserva_habitacion` ACTIVA, sin estancia, de una reserva PENDIENTE, CONFIRMADA o EN_CURSO;
- una estancia ACTIVA (de `checkin_at` a `checkout_previsto`).

La verificación ocurre en el servicio, dentro de la transacción, después de bloquear las filas de las habitaciones (`SELECT … FOR UPDATE`). Así dos recepcionistas no pueden tomar la misma habitación a la vez. Los triggers quedan como última defensa.

### Reservas (RF-RES-06, RF-RES-16)

- Código `R-AAAA-NNNNNN` correlativo por sucursal y año, generado en la transacción.
- Una o varias habitaciones, con el mismo canal, entrada, turno y cantidad para todas. *(decisión: es el caso de grupos y familias; habitaciones con fechas distintas son reservas distintas)*.
- La entrada no puede ser anterior a hoy en Lima. Cantidad de turnos de 1 a 60. Adultos de 1 a 50, niños de 0 a 50.
- Si el canal es una agencia online, se puede guardar el código externo (máx. 50).
- Estados:

```
PENDIENTE ──confirmar──▶ CONFIRMADA
    │                        │
    ├──── check-in (1.ª) ────┴──▶ EN_CURSO ──último check-out──▶ FINALIZADA
    ├──── anular (motivo) ─────▶ CANCELADA
    └──── no-show (motivo, solo pasada la hora de entrada) ──▶ NO_SHOW
```

- Anular y no-show exigen un motivo de 5 a 250 caracteres y guardan usuario y fecha. Ninguna de las dos se aplica a una reserva EN_CURSO o terminada.
- **El estado de la habitación no cambia al reservar.** *(decisión)* El tablero muestra el estado de ahora, y una reserva para la semana que viene no debe pintar hoy la habitación de azul. En su lugar, el tablero agrega a cada habitación su **llegada de hoy** (reserva PENDIENTE o CONFIRMADA con entrada hoy), que se ve en la tarjeta. Los estados RESERVADA y CONFIRMADA siguen disponibles como marca manual.

### Check-in (RF-RES-10, RF-RES-11)

- **Desde una reserva:** por cada habitación de la reserva, a partir del día de entrada y antes de la hora de salida reservada. Toma turno, cantidad, precio, canal y comisión de la reserva. La salida prevista se cuenta desde el ingreso real. Si así se cruza con otra reserva de la habitación → 409, para que recepción reduzca turnos o cambie de habitación.
- **Walk-in:** habitación, canal (por defecto el primero activo, *Recepción* en los datos de ejemplo), turno y cantidad. Precio vigente de hoy.
- La habitación debe estar DESOCUPADA, RESERVADA o CONFIRMADA. Si está en limpieza, mantenimiento u ocupada → 409.
- **Huéspedes:** un titular y acompañantes, todos clientes persona y activos. El total no supera la capacidad del tipo (adultos + niños) → 400. Un cliente que ya está alojado en otra estancia activa no puede ingresar → 409.
- **Datos del libro:** procedencia (obligatoria, 2 a 100), destino (opcional) y motivo del viaje (obligatorio, de la lista Turismo, Negocios, Trabajo, Salud, Estudios, Visita familiar, Otro). Placa del vehículo opcional (hasta 10).
- Efectos en una transacción: estancia ACTIVA, huéspedes, habitación a OCUPADA (con historial «Check-in»), reserva a EN_CURSO. Después se avisa al tablero.

### Extensión (RF-RES-13)

- Suma de 1 a 30 turnos del mismo turno y al mismo precio congelado. La nueva salida no puede cruzarse con otra reserva o estancia → 409.
- Solo para estancias ACTIVA. Auditada.

### Check-out (RF-RES-12)

- **Liquidación** (`GET …/liquidacion`, también se ve antes de confirmar): turnos consumidos = `max(contratados, ⌈(ahora − ingreso − 30 min) / horas del turno⌉)`. La tolerancia de 30 min es la misma que la alerta del tablero. Importe = precio × turnos. Salir antes no devuelve turnos. *(decisión)*
- Al confirmar: si se consumieron más turnos, `cantidad_turnos` sube a los consumidos (así el importe guardado y la salida coinciden). Estancia FINALIZADA, con salida real y usuario. Habitación a LIMPIEZA. Si era la última habitación de su reserva en salir y ya no quedan habitaciones por ingresar, la reserva pasa a FINALIZADA.
- El importe queda en `estancia.monto_hospedaje` para que S-07 emita el comprobante.

### Tablero

- Cada habitación trae `llegada` (código, titular, hora) si tiene una llegada de hoy.
- Check-in, extensión y check-out avisan al tablero (`estado`). Crear, anular o marcar no-show una reserva avisan también, porque cambian la llegada de hoy (nuevo motivo de aviso `reserva`).

## API (sucursal y empresa del token)

`@RequierePermiso` acepta varios permisos (basta uno).

| Método y ruta | Permiso | Auditoría |
|---|---|---|
| `GET /hospedaje/clientes?q=&incluirInactivos=` (doc o nombre, máx. 30) | `cliente.gestionar`, `reserva.crear` o `estancia.checkin` | — |
| `GET /hospedaje/clientes/:id` | ídem | — |
| `POST /hospedaje/clientes` | ídem | `cliente.crear` |
| `PATCH /hospedaje/clientes/:id` | ídem | `cliente.editar` |
| `GET /hospedaje/reservas/calendario?desde=AAAA-MM-DD&dias=1..31` | `reserva.crear` o `estancia.checkin` | — |
| `GET /hospedaje/reservas/disponibles?entrada=ISO&turnoId=&cantidad=&canalId=` (habitaciones libres con precio) | `reserva.crear` o `estancia.checkin` | — |
| `GET /hospedaje/reservas/:id` | ídem | — |
| `POST /hospedaje/reservas` | `reserva.crear` | `reserva.crear` |
| `POST /hospedaje/reservas/:id/confirmar` | `reserva.crear` | `reserva.confirmar` |
| `POST /hospedaje/reservas/:id/anular` `{ motivo }` | `reserva.cancelar` | `reserva.anular` |
| `POST /hospedaje/reservas/:id/no-show` `{ motivo }` | `reserva.cancelar` | `reserva.no_show` |
| `POST /hospedaje/estancias` (walk-in o `reservaHabitacionId`) | `estancia.checkin` | `estancia.checkin` |
| `GET /hospedaje/estancias/:id` | `estancia.checkin` o `estancia.checkout` | — |
| `POST /hospedaje/estancias/:id/extension` `{ turnos }` | `estancia.checkin` | `estancia.extender` |
| `GET /hospedaje/estancias/:id/liquidacion` | `estancia.checkout` | — |
| `POST /hospedaje/estancias/:id/checkout` | `estancia.checkout` | `estancia.checkout` |
| `GET /hospedaje/libro-huespedes?desde=&hasta=` (vista `vw_libro_huespedes`, máx. 31 días) | `estancia.checkin` o `reporte.ver` | — |
| `GET /catalogos/paises` | sesión | — |

Montos como texto con dos decimales. Fechas y horas en ISO (UTC), mostradas en hora de Lima.

## Pantallas

- **Clientes** (menú *Hotel*): buscador por documento o nombre, tabla y panel lateral para crear o editar. Los mismos campos se usan dentro de la reserva y del check-in para dar de alta a alguien sin salir del formulario.
- **Reservas** (reemplaza la maqueta), con dos pestañas:
  - *Calendario*: habitaciones × 14 días, con navegación por semanas y *Hoy*. Barras por reserva (pendiente, confirmada) y por estancia (en curso), con el titular. Clic en una barra abre el detalle: confirmar, anular, no-show y check-in de cada habitación. *+ Nueva reserva* abre el panel: titular (buscar o crear), canal, entrada (fecha y hora, 14:00 por defecto), turno, cantidad, adultos, niños, código externo si es OTA, y las habitaciones disponibles con su precio. El total se calcula a la vista.
  - *Libro de huéspedes*: rango de fechas y tabla con las columnas de la vista.
- **Tablero:** el panel de la habitación agrega *Check-in* (walk-in o la llegada de hoy) si está desocupada, reservada o confirmada. Si está ocupada, muestra los huéspedes, *Extender* y *Check-out* con la liquidación a la vista. La tarjeta muestra «Llega hh:mm · titular». El estado OCUPADA ya no se deja cambiar a mano a LIMPIEZA si hay una estancia activa: eso es el check-out. *(decisión: evita habitaciones libres con estancias abiertas)*

## Pruebas

- **Unitarias de dominio:** documento por tipo (incluido el dígito verificador del RUC), máquina de estados de la reserva, salida por turno, turnos consumidos (antes, dentro de la tolerancia, después, varias veces el turno), cruce de rangos, código correlativo.
- **Integración** (MySQL y Redis reales): cliente con documento repetido 409 y cambio de documento con historia 409; reserva de dos habitaciones con precio y comisión congelados; habitación ya reservada 409; dos reservas simultáneas de la misma habitación (solo una gana); confirmar, anular con motivo y no-show antes de la hora 409; check-in desde reserva (habitación OCUPADA, reserva EN_CURSO); walk-in en habitación en limpieza 409; capacidad excedida 400; huésped ya alojado 409; extensión que choca con una reserva 409; check-out con salida tardía cobra un turno más; la habitación pasa a LIMPIEZA, la reserva a FINALIZADA y una reserva nueva en el rango que quedó libre se acepta; aviso al tablero; permisos 403; auditoría.
- **Cliente:** reglas del formulario (documento, total) y build.

## Orden de construcción

1. Migración, `RequierePermiso` con varios permisos, dominio de clientes y API de clientes.
2. Dominio y API de reservas, disponibilidad y calendario.
3. Check-in, huéspedes, libro, extensión y check-out.
4. Pantallas: clientes, reservas (calendario, panel, libro) y tablero.
5. Seed, README y verificación en el navegador.
