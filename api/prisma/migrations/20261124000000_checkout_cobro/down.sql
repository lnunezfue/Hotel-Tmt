-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations
DROP TABLE estancia_cargo;
ALTER TABLE estancia DROP CHECK ck_estancia_comision, DROP COLUMN comision_porcentaje;
ALTER TABLE reserva DROP CHECK ck_reserva_comision, DROP COLUMN comision_porcentaje;
