-- S-07: check-out con cobro, consumos durante la estadía y comisión del canal congelada en la venta
-- Spec: docs/superpowers/specs/2026-11-24-s07-checkout-cobro-design.md

-- Comisión del canal vigente al vender: cambiarla después no altera reportes (pendiente anotado en S-05)
ALTER TABLE reserva
  ADD COLUMN comision_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0.00
    COMMENT 'Comisión del canal al momento de reservar' AFTER canal_venta_id,
  ADD CONSTRAINT ck_reserva_comision CHECK (comision_porcentaje BETWEEN 0 AND 100);
ALTER TABLE estancia
  ADD COLUMN comision_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0.00
    COMMENT 'Comisión del canal al momento del check-in' AFTER canal_venta_id,
  ADD CONSTRAINT ck_estancia_comision CHECK (comision_porcentaje BETWEEN 0 AND 100);

UPDATE reserva r JOIN canal_venta c ON c.id = r.canal_venta_id SET r.comision_porcentaje = c.comision_porcentaje;
UPDATE estancia e JOIN canal_venta c ON c.id = e.canal_venta_id SET e.comision_porcentaje = c.comision_porcentaje;

-- Consumos y cargos de la estadía (frigobar, lavandería, hora extra...) que se cobran en el check-out
CREATE TABLE estancia_cargo (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estancia_id      BIGINT UNSIGNED NOT NULL,
  producto_id      INT UNSIGNED NULL COMMENT 'NULL = cargo libre (p. ej. hora extra)',
  descripcion      VARCHAR(200) NOT NULL,
  cantidad         DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  precio_unitario  DECIMAL(14,2) NOT NULL COMMENT 'Con IGV',
  total            DECIMAL(14,2) GENERATED ALWAYS AS (ROUND(cantidad * precio_unitario, 2)) STORED,
  anulado          TINYINT(1) NOT NULL DEFAULT 0,
  usuario_id       INT UNSIGNED NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ec_estancia (estancia_id),
  KEY ix_ec_producto (producto_id),
  KEY ix_ec_usuario (usuario_id),
  CONSTRAINT fk_ec_estancia FOREIGN KEY (estancia_id) REFERENCES estancia (id),
  CONSTRAINT fk_ec_producto FOREIGN KEY (producto_id) REFERENCES producto (id),
  CONSTRAINT fk_ec_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuario (id),
  CONSTRAINT ck_ec_montos CHECK (cantidad > 0 AND precio_unitario >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Cargos de una estadía que se facturan al salir';
