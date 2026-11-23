-- S-06: plano visual del hotel, comodidades por habitación y reservas
-- Spec: docs/superpowers/specs/2026-11-23-s06-plano-reservas-design.md

-- Plano: cada piso es una cuadrícula; habitaciones y elementos ocupan rectángulos de celdas.
ALTER TABLE piso
  ADD COLUMN plano_columnas TINYINT UNSIGNED NOT NULL DEFAULT 12 COMMENT 'Ancho del plano en celdas' AFTER nombre,
  ADD COLUMN plano_filas    TINYINT UNSIGNED NOT NULL DEFAULT 6  COMMENT 'Alto del plano en celdas' AFTER plano_columnas,
  ADD CONSTRAINT ck_piso_plano CHECK (plano_columnas BETWEEN 4 AND 30 AND plano_filas BETWEEN 3 AND 20);

ALTER TABLE habitacion
  ADD COLUMN plano_x     TINYINT UNSIGNED NULL COMMENT 'Columna en el plano (0 = izquierda); NULL = sin ubicar' AFTER descripcion,
  ADD COLUMN plano_y     TINYINT UNSIGNED NULL COMMENT 'Fila en el plano (0 = arriba)' AFTER plano_x,
  ADD COLUMN plano_ancho TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER plano_y,
  ADD COLUMN plano_alto  TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER plano_ancho,
  ADD CONSTRAINT ck_hab_plano CHECK (plano_ancho BETWEEN 1 AND 10 AND plano_alto BETWEEN 1 AND 10 AND (plano_x IS NULL) = (plano_y IS NULL));

CREATE TABLE plano_elemento (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  piso_id   INT UNSIGNED NOT NULL,
  tipo      ENUM('PASILLO','ESCALERA','ASCENSOR','RECEPCION','AREA_COMUN','BANO_COMUN') NOT NULL,
  etiqueta  VARCHAR(40) NULL,
  x         TINYINT UNSIGNED NOT NULL,
  y         TINYINT UNSIGNED NOT NULL,
  ancho     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  alto      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY ix_pe_piso (piso_id),
  CONSTRAINT fk_pe_piso FOREIGN KEY (piso_id) REFERENCES piso (id) ON DELETE CASCADE,
  CONSTRAINT ck_pe_tamano CHECK (ancho BETWEEN 1 AND 30 AND alto BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Pasillos, escaleras y áreas comunes dibujados en el plano del piso';

-- Comodidades (aire acondicionado, wifi, TV...): catálogo por empresa y asignación por habitación.
CREATE TABLE amenidad (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id  INT UNSIGNED NOT NULL,
  codigo      VARCHAR(30) NOT NULL,
  nombre      VARCHAR(60) NOT NULL,
  icono       VARCHAR(30) NOT NULL COMMENT 'Clave del dibujo en el cliente (aire, wifi, tv...)',
  orden       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_amenidad (empresa_id, codigo),
  CONSTRAINT fk_amenidad_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Comodidades que puede tener una habitación';

CREATE TABLE habitacion_amenidad (
  habitacion_id INT UNSIGNED NOT NULL,
  amenidad_id   SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (habitacion_id, amenidad_id),
  KEY ix_ha_amenidad (amenidad_id),
  CONSTRAINT fk_ha_habitacion FOREIGN KEY (habitacion_id) REFERENCES habitacion (id) ON DELETE CASCADE,
  CONSTRAINT fk_ha_amenidad   FOREIGN KEY (amenidad_id)   REFERENCES amenidad (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Catálogo inicial para cada empresa existente (las nuevas lo reciben del seed o de la pantalla).
INSERT INTO amenidad (empresa_id, codigo, nombre, icono, orden)
SELECT e.id, a.codigo, a.nombre, a.icono, a.orden
FROM empresa e
CROSS JOIN (
  SELECT 'AIRE' AS codigo, 'Aire acondicionado' AS nombre, 'aire' AS icono, 1 AS orden UNION ALL
  SELECT 'WIFI', 'Internet wifi', 'wifi', 2 UNION ALL
  SELECT 'TV', 'Televisor', 'tv', 3 UNION ALL
  SELECT 'AGUA_CALIENTE', 'Agua caliente', 'ducha', 4 UNION ALL
  SELECT 'BANO_PRIVADO', 'Baño privado', 'bano', 5 UNION ALL
  SELECT 'FRIGOBAR', 'Frigobar', 'frigobar', 6 UNION ALL
  SELECT 'CAJA_FUERTE', 'Caja fuerte', 'caja_fuerte', 7 UNION ALL
  SELECT 'CALEFACCION', 'Calefacción', 'calefaccion', 8 UNION ALL
  SELECT 'BALCON', 'Balcón', 'balcon', 9 UNION ALL
  SELECT 'JACUZZI', 'Jacuzzi', 'jacuzzi', 10 UNION ALL
  SELECT 'ESCRITORIO', 'Escritorio de trabajo', 'escritorio', 11 UNION ALL
  SELECT 'ACCESIBLE', 'Accesible (silla de ruedas)', 'accesible', 12
) a;

-- Permisos de reservas que el seed de S-01 solo daba a RECEPCIONISTA: aquí quedan para cualquier entorno.
INSERT IGNORE INTO permiso (codigo, modulo, descripcion) VALUES
  ('reserva.ver', 'RESERVAS', 'Ver el calendario de reservas y la disponibilidad');
INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN ('reserva.ver', 'reserva.crear', 'reserva.cancelar', 'estancia.checkin')
WHERE r.nombre = 'ADMINISTRADOR'
   OR (r.nombre = 'RECEPCIONISTA' AND p.codigo = 'reserva.ver');
