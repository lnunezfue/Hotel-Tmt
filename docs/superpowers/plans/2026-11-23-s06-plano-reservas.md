# Plan — S-06 plano visual, comodidades y reservas

Spec: `docs/superpowers/specs/2026-11-23-s06-plano-reservas-design.md`. Rama `s06-plano-reservas`, sobre `s05-tablero-en-vivo`.

- [x] Migración `20261123000000_plano_amenidades_reservas` con `down.sql`; `schema.prisma`; seed con plano, comodidades y reservas de ejemplo.
- [x] Dominio: `plano.ts` (superposición, huecos, distribución inicial), `amenidad.ts`, `reserva.ts` (rangos, estados, capacidad, documentos) con pruebas.
- [x] API del plano y comodidades + `plano.e2e-spec.ts`.
- [x] API de reservas, disponibilidad, check-in y huéspedes + `reservas.e2e-spec.ts`.
- [x] Cliente: dibujos, íconos, geometría; página *Plano del hotel* (ver, reservar, diseñar); formulario de reserva; calendario.
- [x] Menú compacto en pantallas chicas; sin `confirm()` (no funciona dentro de vistas incrustadas).
- [x] Demostración web (`build:demo`) con API simulada.
- [x] README (avance y guion), CI sin cambios (la migración entra en `prisma:deploy`).
