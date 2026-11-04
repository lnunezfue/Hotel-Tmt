-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations
DROP TRIGGER trg_aud_bd_prohibido;
DROP TRIGGER trg_aud_bu_inmutable;

ALTER TABLE auditoria
  DROP FOREIGN KEY fk_aud_sucursal,
  DROP KEY ix_aud_usuario_fecha,
  DROP COLUMN user_agent,
  DROP COLUMN sucursal_id,
  MODIFY COLUMN registro_id BIGINT UNSIGNED NOT NULL,
  MODIFY COLUMN accion ENUM('INSERT','UPDATE','DELETE','ANULAR','LOGIN') NOT NULL;

ALTER TABLE empresa
  DROP CHECK ck_empresa_inactividad,
  DROP COLUMN sesion_inactividad_min;

DROP TABLE sesion_usuario;
