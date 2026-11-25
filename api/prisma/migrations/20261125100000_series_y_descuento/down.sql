-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations.
-- Las asignaciones de usuario_serie borradas no se recuperan.
ALTER TABLE comprobante DROP CHECK ck_comp_descuento, DROP COLUMN descuento_motivo, DROP COLUMN descuento_igv;
