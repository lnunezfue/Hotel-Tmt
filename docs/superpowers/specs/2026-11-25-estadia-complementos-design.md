# Complementos de la estadía sobre S-06 y S-07

| | |
|---|---|
| Fecha | 2026-11-25 |
| Estado | Implementado en la rama `s07-integracion` (sobre `s07-checkout-cobro`, PR #5, más `s05-tablero-en-vivo`, PR #3) |
| Requerimientos | RF-RES-11 libro de huéspedes · RF-RES-12 check-out por turnos consumidos · RF-RES-13 extensión · RF-RES-14 traslado · RF-RES-16 responsable de la anulación · RF-RES-17 clientes · RF-RES-18 cruces |
| Origen | El S-06 se hizo dos veces en paralelo (`s06-plano-reservas` de lnunezfue y `s06-reservas` de jchanganamez). Se toma como base la de lnunezfue, que además trae el S-07, y se le suma lo que faltaba de la otra. `s06-reservas` queda descartada |

## Qué se integró

1. **S-05 completo.** La rama del plano salió del S-05 antes de los turnos. Se fusiona `s05-tablero-en-vivo` y se quita el límite de turnos de 3, 6, 12 y 24 h: la salida prevista acepta cualquier turno de 1 a 24 h.
2. **Complementos** (no estaban en `s06-plano-reservas` ni en `s07-checkout-cobro`):

| Tema | Qué hace |
|---|---|
| Extensión (RF-RES-13) | `POST /estancias/:id/extension { turnos }`: de 1 a 30 turnos al precio pactado. La habitación se bloquea; si la nueva salida choca con una reserva o estadía → 409. La habitación de la reserva acompaña la nueva salida |
| Traslado (RF-RES-14) | `POST /estancias/:id/traslado { habitacionId, motivo }`: la estadía pasa a otra habitación lista y libre, con capacidad para sus huéspedes. Origen a LIMPIEZA, destino a OCUPADA, registro en `estancia_traslado`, auditado. El precio pactado no cambia *(decisión: un traslado suele ser por un problema del hotel)* |
| Salida tardía (RF-RES-12) | La cuenta de una estadía en curso suma un turno por cada turno (o fracción) pasado desde la salida prevista, después de 30 min de tolerancia (la misma que la alerta del tablero). Salir antes no devuelve turnos. Al cobrar se guardan los turnos consumidos. Sigue existiendo el cargo libre para casos especiales |
| Libro de huéspedes (RF-RES-11) | Destino y motivo del viaje (lista: Turismo, Negocios, Trabajo, Salud, Estudios, Visita familiar, Otro) en ambos check-in. `GET /libro-huespedes?desde&hasta` (hasta 31 días) sobre la vista `vw_libro_huespedes`, y pantalla *Libro de huéspedes*. La API los acepta opcionales para no romper integraciones; la pantalla pide procedencia y motivo |
| Anulación (RF-RES-16) | Cancelar y «no se presentó» exigen motivo y guardan `usuario_cancelacion_id` y `cancelada_at`. La reserva los muestra (`canceladaPor`, `canceladaEn`) |
| Clientes (RF-RES-17) | `GET /clientes/cartera`, `GET /clientes/:id`, `PATCH /clientes/:id` y pantalla *Clientes*. El documento no cambia si el cliente ya tiene reservas, estadías o comprobantes → 409. Permiso nuevo `cliente.gestionar` (ADMINISTRADOR, RECEPCIONISTA, CAJERO): caja puede registrar al cliente de una factura sin poder reservar |
| Cruces (RF-RES-18) | Los triggers comparan reserva con reserva y estadía con estadía. Ahora la reserva se cruza con las estadías en curso y el walk-in con las reservas por llegar, con las habitaciones bloqueadas (`SELECT … FOR UPDATE`) para que dos recepcionistas no tomen la misma |
| Huéspedes | Un huésped no se aloja en dos habitaciones a la vez (409). Una empresa (RUC 20) reserva y recibe factura, pero no se aloja: en el check-in de su reserva se indica quién ocupa cada habitación |
| Estado de la habitación | OCUPADA ya no se marca a mano (es el check-in), y una habitación con estadía en curso no cambia de estado a mano (se libera con el check-out o el traslado) |
| Permisos | `@RequierePermiso` acepta varios códigos (basta uno) |

Se mantiene la decisión D10 del S-06: una reserva para hoy pone la habitación en RESERVADA o CONFIRMADA. Una reserva hecha antes para hoy no cambia el color hasta que alguien la toque; queda anotado para revisar.

## Base de datos

Migración `20261125000000_estadia_complementos` (con `down.sql`, probada subir → bajar → subir):
- `reserva.usuario_cancelacion_id` (FK a usuario) y `reserva.cancelada_at`.
- Tabla `estancia_traslado` (estadía, habitación de origen y destino, motivo, usuario, fecha; CHECK origen ≠ destino).
- Permiso `cliente.gestionar` para ADMINISTRADOR, RECEPCIONISTA y CAJERO.

`schema.prisma` se regeneró desde la base: el generador pierde los comentarios `///` que se habían escrito a mano y reordena los modelos.

## Pruebas

- Unitarias: `estancias/domain/estadia.spec.ts` (salida tardía, extensión, motivo de traslado, cruces, libro) y salida prevista con cualquier turno.
- Integración: `test/estadia.e2e-spec.ts` (10 casos): libro con destino y motivo; extensión libre y con choque; reserva sobre estadía y walk-in sobre reserva; huésped alojado dos veces y empresa como huésped; salida tardía cobrada; traslado; no-show con motivo y responsable; estado manual; edición de clientes y permiso de caja.
- Cliente: `features/estancias/libro.test.ts`.
- Demo web: la API simulada atiende extensión, traslado, libro, cartera y ficha de clientes.
