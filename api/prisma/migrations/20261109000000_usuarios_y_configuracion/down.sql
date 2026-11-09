-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations
-- Solo se quita lo que crea esta migración; usuario.ver y habitacion.* ya existían con el seed de S-01.
DELETE rp FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE p.codigo = 'usuario.gestionar';
DELETE FROM permiso WHERE codigo = 'usuario.gestionar';

-- El ENUM anterior no admite CAMBIO_CLAVE: esas filas pasan a ADMIN (la más cercana)
UPDATE sesion_usuario SET motivo_revocacion = 'ADMIN' WHERE motivo_revocacion = 'CAMBIO_CLAVE';
ALTER TABLE sesion_usuario
  MODIFY COLUMN motivo_revocacion ENUM('LOGOUT','INACTIVIDAD','REUSO','USUARIO_INACTIVO','EXPIRADA','ADMIN') NULL;

ALTER TABLE usuario DROP COLUMN debe_cambiar_clave;
