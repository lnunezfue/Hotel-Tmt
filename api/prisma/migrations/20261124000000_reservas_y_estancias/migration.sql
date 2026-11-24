-- S-06: clientes, reservas, check-in, check-out y extensión
-- Spec: docs/superpowers/specs/2026-11-24-s06-ciclo-hospedaje-design.md

-- Comisión congelada al reservar o hacer el check-in: cambiarla después en el canal no altera reportes
ALTER TABLE reserva
  ADD COLUMN comision_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0.00
    COMMENT 'Copia de canal_venta.comision_porcentaje al reservar' AFTER canal_venta_id,
  ADD COLUMN usuario_cancelacion_id INT UNSIGNED NULL
    COMMENT 'Quien anuló o marcó no-show (RF-RES-16)' AFTER motivo_cancelacion,
  ADD COLUMN cancelada_at DATETIME NULL AFTER usuario_cancelacion_id,
  ADD KEY ix_reserva_ucan (usuario_cancelacion_id),
  ADD CONSTRAINT fk_reserva_ucan FOREIGN KEY (usuario_cancelacion_id) REFERENCES usuario (id),
  ADD CONSTRAINT ck_reserva_comision CHECK (comision_porcentaje BETWEEN 0 AND 100);

ALTER TABLE estancia
  ADD COLUMN comision_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0.00
    COMMENT 'La de la reserva o, en un walk-in, la del canal' AFTER canal_venta_id,
  ADD CONSTRAINT ck_est_comision CHECK (comision_porcentaje BETWEEN 0 AND 100);

-- Una habitación de reserva que ya tiene estancia deja de bloquear por su rango reservado:
-- desde el check-in bloquea la estancia, que puede terminar antes o extenderse.
DROP TRIGGER trg_rh_bi_solape;
DROP TRIGGER trg_rh_bu_solape;

CREATE TRIGGER trg_rh_bi_solape BEFORE INSERT ON reserva_habitacion
FOR EACH ROW
BEGIN
  IF NEW.estado = 'ACTIVA' AND EXISTS (
      SELECT 1
        FROM reserva_habitacion rh
        JOIN reserva r ON r.id = rh.reserva_id
       WHERE rh.habitacion_id = NEW.habitacion_id
         AND rh.estado = 'ACTIVA'
         AND r.estado IN ('PENDIENTE','CONFIRMADA','EN_CURSO')
         AND NOT EXISTS (SELECT 1 FROM estancia e WHERE e.reserva_habitacion_id = rh.id)
         AND rh.fecha_entrada < NEW.fecha_salida
         AND rh.fecha_salida  > NEW.fecha_entrada) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La habitación ya está reservada en ese rango de fechas';
  END IF;
END;

CREATE TRIGGER trg_rh_bu_solape BEFORE UPDATE ON reserva_habitacion
FOR EACH ROW
BEGIN
  IF NEW.estado = 'ACTIVA' AND EXISTS (
      SELECT 1
        FROM reserva_habitacion rh
        JOIN reserva r ON r.id = rh.reserva_id
       WHERE rh.habitacion_id = NEW.habitacion_id
         AND rh.id <> NEW.id
         AND rh.estado = 'ACTIVA'
         AND r.estado IN ('PENDIENTE','CONFIRMADA','EN_CURSO')
         AND NOT EXISTS (SELECT 1 FROM estancia e WHERE e.reserva_habitacion_id = rh.id)
         AND rh.fecha_entrada < NEW.fecha_salida
         AND rh.fecha_salida  > NEW.fecha_entrada) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La habitación ya está reservada en ese rango de fechas';
  END IF;
END;

-- Permiso de clientes y permisos de reservas para recepción (hasta ahora solo los daba el seed)
INSERT IGNORE INTO permiso (codigo, modulo, descripcion) VALUES
  ('cliente.gestionar', 'RESERVAS', 'Buscar, crear y editar clientes y huéspedes');

INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM rol r
JOIN permiso p ON p.codigo = 'cliente.gestionar'
WHERE r.nombre IN ('ADMINISTRADOR', 'RECEPCIONISTA', 'CAJERO');

INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM rol r
JOIN permiso p ON p.codigo IN ('reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'estancia.checkout')
WHERE r.nombre = 'RECEPCIONISTA';
