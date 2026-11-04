CREATE TABLE sesion_usuario (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id             INT UNSIGNED    NOT NULL,
  sucursal_id            INT UNSIGNED    NOT NULL COMMENT 'Sucursal activa',
  refresh_hash           CHAR(64)        NOT NULL COMMENT 'SHA-256 hex del secreto vigente',
  refresh_hash_anterior  CHAR(64)        NULL     COMMENT 'Secreto previo, válido solo durante la tolerancia de carrera',
  rotada_at              DATETIME        NULL,
  ip                     VARCHAR(45)     NULL,
  user_agent             VARCHAR(255)    NULL,
  creada_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_renovacion_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at              DATETIME        NOT NULL COMMENT 'creada_at + duración máxima',
  revocada_at            DATETIME        NULL,
  motivo_revocacion      ENUM('LOGOUT','INACTIVIDAD','REUSO','USUARIO_INACTIVO','EXPIRADA','ADMIN') NULL,
  PRIMARY KEY (id),
  KEY ix_sesion_usuario (usuario_id, revocada_at),
  CONSTRAINT fk_sesion_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuario (id),
  CONSTRAINT fk_sesion_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id),
  CONSTRAINT ck_sesion_expira   CHECK (expira_at > creada_at),
  CONSTRAINT ck_sesion_revocada CHECK ((revocada_at IS NULL) = (motivo_revocacion IS NULL))
) ENGINE=InnoDB COMMENT='Sesiones de usuario con token de renovación rotativo';

ALTER TABLE empresa
  ADD COLUMN sesion_inactividad_min SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER igv_porcentaje,
  ADD CONSTRAINT ck_empresa_inactividad CHECK (sesion_inactividad_min BETWEEN 15 AND 480);

ALTER TABLE auditoria
  MODIFY COLUMN accion      VARCHAR(40)     NOT NULL COMMENT 'Código modulo.accion; lista en ACCIONES_AUDITORIA',
  MODIFY COLUMN registro_id BIGINT UNSIGNED NULL,
  ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER usuario_id,
  ADD COLUMN user_agent  VARCHAR(255) NULL AFTER ip,
  ADD KEY ix_aud_usuario_fecha (usuario_id, created_at),
  ADD CONSTRAINT fk_aud_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id);

-- Inmutabilidad (D7)
CREATE TRIGGER trg_aud_bu_inmutable BEFORE UPDATE ON auditoria FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitácora de auditoría no se modifica';
CREATE TRIGGER trg_aud_bd_prohibido BEFORE DELETE ON auditoria FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitácora de auditoría no se elimina';
