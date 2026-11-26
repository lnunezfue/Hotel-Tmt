# Plan: operación real del hotel

Spec: `docs/superpowers/specs/2026-11-26-operacion-real-design.md` · Rama: `operacion-real` (base `s07-comprobantes`)

## Tareas

- [x] Migración `20261126000000_operacion_sucursal` (operación, franjas, `estancia_cargo.comprobante_id`, CULQI, permiso) con `down.sql`; `schema.prisma` parchado a mano.
- [x] Dominio `hospedaje/domain/operacion.ts`: franjas, salida máxima, salida por horas con tope, salida de la noche, limpieza; pruebas unitarias.
- [x] `OperacionService` y `GET/PUT /hospedaje/operacion` con auditoría.
- [x] Tablero: `estadoDesde` y `limpieza` desde el historial.
- [x] Estancias: salida según la operación en el check-in directo; tope en la extensión; cuenta con pendientes y cobrado; `POST /estancias/:id/cobro`; check-out sin cobro con la cuenta pagada.
- [x] Reservas: rango con la operación (noche 9:00, tope por franja); check-in de reserva con el tiempo desde la llegada.
- [x] Corrección del id del pago en el movimiento de caja.
- [x] e2e `operacion.e2e-spec.ts`; las demás suites apartan la operación del seed y la devuelven al terminar.
- [x] Seed: Hotel Centro con el plano real de 2 niveles, turno de 4 h, estadías pagadas al ingreso con sus boletas, limpiezas con tiempo, reservas sin adelanto, operación configurada.
- [x] Web: pago adelantado en el check-in con vista previa de la salida; *Cobrar* en la estadía; check-out de cuenta pagada; consumos ocultos si no se venden; tablero con tiempo de limpieza; pestaña *Operación*.
- [x] Demo: captura de la foto con `web/scripts/capturar-demo.mjs`, API simulada con la misma regla, recorrido guiado nuevo de 7 pasos; publicada en `gh-pages`.

## Verificación

```
pnpm --filter api test          # unitarias
pnpm --filter api test:e2e      # integración (MySQL y Redis)
pnpm --filter web test
pnpm --filter web build:demo    # y recorrer la demo
```
