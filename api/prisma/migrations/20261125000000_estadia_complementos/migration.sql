-- Complementos del ciclo de hospedaje: responsable de la anulación, traslados y permiso de clientes
-- Spec: docs/superpowers/specs/2026-11-25-estadia-complementos-design.md

-- Quién y cuándo anuló o marcó «no se presentó» (RF-RES-16); el motivo ya tiene columna
ALTER TABLE reserva
  ADD COLUMN usuario_cancelacion_id INT UNSIGNED NULL
    COMMENT 'Quien canceló o marcó no-show' AFTER motivo_cancelacion,
  ADD COLUMN cancelada_at DATETIME NULL AFTER usuario_cancelacion_id,
  ADD KEY ix_reserva_ucan (usuario_cancelacion_id),
  ADD CONSTRAINT fk_reserva_ucan FOREIGN KEY (usuario_cancelacion_id) REFERENCES usuario (id);

-- Traslado de un huésped a otra habitación con su motivo y responsable (RF-RES-14)
CREATE TABLE estancia_traslado (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estancia_id            BIGINT UNSIGNED NOT NULL,
  habitacion_origen_id   INT UNSIGNED NOT NULL,
  habitacion_destino_id  INT UNSIGNED NOT NULL,
  motivo                 VARCHAR(200) NOT NULL,
  usuario_id             INT UNSIGNED NOT NULL,
  fecha_hora             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_et_estancia (estancia_id),
  KEY ix_et_origen (habitacion_origen_id),
  KEY ix_et_destino (habitacion_destino_id),
  KEY ix_et_usuario (usuario_id),
  CONSTRAINT fk_et_estancia FOREIGN KEY (estancia_id)           REFERENCES estancia (id),
  CONSTRAINT fk_et_origen   FOREIGN KEY (habitacion_origen_id)  REFERENCES habitacion (id),
  CONSTRAINT fk_et_destino  FOREIGN KEY (habitacion_destino_id) REFERENCES habitacion (id),
  CONSTRAINT fk_et_usuario  FOREIGN KEY (usuario_id)            REFERENCES usuario (id),
  CONSTRAINT ck_et_distinta CHECK (habitacion_origen_id <> habitacion_destino_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Traslados de huéspedes entre habitaciones';

-- Clientes: buscar, crear y editar sin necesidad de reservar (caja factura a empresas)
INSERT IGNORE INTO permiso (codigo, modulo, descripcion) VALUES
  ('cliente.gestionar', 'RESERVAS', 'Buscar, crear y editar clientes y huéspedes');

INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM rol r
JOIN permiso p ON p.codigo = 'cliente.gestionar'
WHERE r.nombre IN ('ADMINISTRADOR', 'RECEPCIONISTA', 'CAJERO');
