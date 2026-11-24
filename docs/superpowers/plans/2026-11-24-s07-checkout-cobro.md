# Plan — S-07 check-out con cobro

Spec: `docs/superpowers/specs/2026-11-24-s07-checkout-cobro-design.md`. Rama `s07-checkout-cobro`, sobre `s06-plano-reservas`.

- [x] Migración `20261124000000_checkout_cobro` con `down.sql` (comisión en reserva y estancia, `estancia_cargo`); productos en el seed.
- [x] Dominio `estancias/domain/cobro.ts` + spec.
- [x] Módulo `caja` (abrir, movimientos, cerrar con `sp_cerrar_caja`).
- [x] Módulo `estancias` (check-in directo, acompañantes, cargos, cuenta, check-out con comprobante y caja; lectura de comprobantes).
- [x] Reservas: varias habitaciones, adelanto en caja, comisión y acompañantes en el check-in.
- [x] `checkout.e2e-spec.ts`.
- [x] Cliente: cajón de estadía, check-out, ticket, check-in directo, reserva múltiple, pantalla Caja.
- [x] Demo web con recorrido guiado.
