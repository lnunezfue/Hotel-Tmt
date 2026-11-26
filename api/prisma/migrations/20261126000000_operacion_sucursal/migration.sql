-- S-08: operación real de la sucursal (hotel de parejas, estadías cortas con pago adelantado)
-- Spec: docs/superpowers/specs/2026-11-26-s08-operacion-real-design.md

-- Cómo trabaja cada sucursal. Sin fila, la sucursal sigue las reglas de siempre (salida 12:00, sin topes, cobro al salir).
CREATE TABLE sucursal_operacion (
  sucursal_id       INT UNSIGNED     NOT NULL,
  cobro_al_ingreso  TINYINT(1)       NOT NULL DEFAULT 1  COMMENT 'Se cobra en el check-in; el check-out solo cobra lo que falte',
  vende_consumos    TINYINT(1)       NOT NULL DEFAULT 0  COMMENT 'Muestra los consumos (frigobar, servicios) en la estadía',
  minutos_limpieza  SMALLINT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'Tiempo esperado de limpieza; el tablero avisa al pasarlo',
  hora_salida_noche TIME             NOT NULL DEFAULT '09:00:00' COMMENT 'Salida de la noche o turno completo (turno de 24 h)',
  turno_sugerido_id TINYINT UNSIGNED NULL COMMENT 'Turno que el check-in propone primero (el promedio de estadía)',
  updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sucursal_id),
  CONSTRAINT fk_sop_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id),
  CONSTRAINT fk_sop_turno FOREIGN KEY (turno_sugerido_id) REFERENCES turno (id),
  CONSTRAINT ck_sop_limpieza CHECK (minutos_limpieza BETWEEN 5 AND 240)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Hora máxima de salida según la hora del check-in (franjas de Lima). `hasta` es exclusiva; `dias_despues` = 0 mismo día.
CREATE TABLE sucursal_franja_salida (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  sucursal_id    INT UNSIGNED     NOT NULL,
  nombre         VARCHAR(30)      NOT NULL,
  desde          TIME             NOT NULL,
  hasta          TIME             NOT NULL COMMENT '00:00 = medianoche (fin del día)',
  salida_maxima  TIME             NOT NULL,
  dias_despues   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_franja_desde (sucursal_id, desde),
  CONSTRAINT fk_franja_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id) ON DELETE CASCADE,
  CONSTRAINT ck_franja_dias CHECK (dias_despues <= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Con cobro al ingreso la cuenta se cobra en partes: cada cargo recuerda el comprobante que lo cobró
ALTER TABLE estancia_cargo
  ADD COLUMN comprobante_id BIGINT UNSIGNED NULL COMMENT 'Comprobante que cobró el cargo; NULL = pendiente' AFTER anulado,
  ADD CONSTRAINT fk_ecargo_comprobante FOREIGN KEY (comprobante_id) REFERENCES comprobante (id);

-- Culqi (tarjeta por pasarela) se cobra en el hotel junto con el efectivo
INSERT INTO metodo_pago (codigo, descripcion, es_efectivo)
SELECT 'CULQI', 'Culqi (tarjeta / QR)', 0 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM metodo_pago WHERE codigo = 'CULQI');

-- Configurar la operación es parte de administrar el hotel
INSERT INTO permiso (codigo, modulo, descripcion)
SELECT 'operacion.configurar', 'RESERVAS', 'Configurar la operación de la sucursal (cobro, limpieza, horarios de salida)' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permiso WHERE codigo = 'operacion.configurar');
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'operacion.configurar'
WHERE r.nombre = 'ADMINISTRADOR' AND NOT EXISTS (SELECT 1 FROM rol_permiso x WHERE x.rol_id = r.id AND x.permiso_id = p.id);
