-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations
DELETE rp FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE p.codigo = 'cliente.gestionar';
DELETE FROM permiso WHERE codigo = 'cliente.gestionar';
DROP TABLE estancia_traslado;
ALTER TABLE reserva DROP FOREIGN KEY fk_reserva_ucan, DROP KEY ix_reserva_ucan, DROP COLUMN cancelada_at, DROP COLUMN usuario_cancelacion_id;
