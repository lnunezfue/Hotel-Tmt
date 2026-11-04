-- Esquema inicial hotel_db v1.1 (DT-001 + tipos de movimiento y comprobante)
/* =====================================================================
   SISTEMA HOTELERO + FACTURACIÓN ELECTRÓNICA SUNAT (Perú)
   Motor   : MySQL 8.0.16+ (InnoDB, utf8mb4)
   Esquema : hotel_db
   Versión : 1.1  (2026-11-04)  · tipos de movimiento INGRESO/EGRESO y comprobantes FACTURA/BOLETA/INTERNO

   Convenciones:
   - Tablas en singular, snake_case. PK = id (BIGINT/INT UNSIGNED AUTO_INCREMENT).
   - FK = <tabla_referenciada>_id ; nombre de constraint fk_<tabla>_<ref>.
   - Índices: uk_ (único), ix_ (búsqueda), ck_ (check).
   - Dinero: DECIMAL(14,2); precios/cantidades unitarias: DECIMAL(14,4)/(12,3).
   - Fechas/hora en DATETIME (hora local Perú, UTC-5); auditoría en TIMESTAMP.
   - Borrado lógico en catálogos (activo), los documentos tributarios NUNCA se borran:
     se anulan (baja / nota de crédito).
   ===================================================================== */



/* =====================================================================
   1. CATÁLOGOS SUNAT Y GENERALES
   ===================================================================== */

-- Catálogo 06: tipo de documento de identidad
CREATE TABLE tipo_documento_identidad (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_sunat  CHAR(1)      NOT NULL,
  abreviatura   VARCHAR(10)  NOT NULL,
  descripcion   VARCHAR(100) NOT NULL,
  longitud      TINYINT UNSIGNED NULL COMMENT 'Longitud exacta si aplica (DNI 8, RUC 11)',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tdi_codigo (codigo_sunat)
) ENGINE=InnoDB COMMENT='SUNAT Cat.06 - Tipo de documento de identidad';

-- Tipos de comprobante: FACTURA, BOLETA, INTERNO (+ notas que los corrigen y guía para compras)
CREATE TABLE tipo_comprobante (
  id              TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo          VARCHAR(20)  NOT NULL COMMENT 'FACTURA, BOLETA, INTERNO, NOTA_CREDITO, NOTA_DEBITO, GUIA_REMISION',
  codigo_sunat    VARCHAR(2)   NULL COMMENT 'Cat.01 SUNAT (01, 03, 07, 08, 09); NULL para INTERNO',
  descripcion     VARCHAR(100) NOT NULL,
  prefijo_serie   CHAR(1)      NULL COMMENT 'Primera letra de la serie: F, B, I, T',
  envia_sunat     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1 = comprobante electrónico que se firma y envía a SUNAT; 0 = INTERNO',
  uso_venta       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = se elige al cobrar (FACTURA, BOLETA, INTERNO)',
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tcomp_codigo (codigo),
  UNIQUE KEY uk_tcomp_codigo_sunat (codigo_sunat),
  CONSTRAINT ck_tcomp_sunat CHECK (envia_sunat = 0 OR codigo_sunat IS NOT NULL)
) ENGINE=InnoDB COMMENT='Tipos de comprobante: FACTURA, BOLETA, INTERNO y notas';

-- Tipos de movimiento: INGRESO (+1) y EGRESO (-1), comunes a caja e inventario
CREATE TABLE tipo_movimiento (
  id           TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo       VARCHAR(10)  NOT NULL COMMENT 'INGRESO o EGRESO',
  descripcion  VARCHAR(60)  NOT NULL,
  signo        TINYINT      NOT NULL COMMENT '+1 suma, -1 resta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_tmov_codigo (codigo),
  CONSTRAINT ck_tmov_signo CHECK (signo IN (1, -1))
) ENGINE=InnoDB COMMENT='Tipos de movimiento: INGRESO / EGRESO';

-- Conceptos de movimiento: cada concepto pertenece a un tipo y a un ámbito (caja o inventario)
CREATE TABLE concepto_movimiento (
  id                  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_movimiento_id  TINYINT UNSIGNED NOT NULL,
  ambito              ENUM('CAJA','INVENTARIO') NOT NULL,
  codigo              VARCHAR(30)  NOT NULL,
  descripcion         VARCHAR(100) NOT NULL,
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cmov (ambito, codigo),
  KEY ix_cmov_tipo (tipo_movimiento_id),
  CONSTRAINT fk_cmov_tipo FOREIGN KEY (tipo_movimiento_id) REFERENCES tipo_movimiento (id)
) ENGINE=InnoDB COMMENT='Concepto del movimiento (VENTA, GASTO, COMPRA, MERMA...) y su tipo INGRESO/EGRESO';

-- Catálogos 09 y 10: motivos de nota de crédito / débito
CREATE TABLE motivo_nota (
  id                   TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_comprobante_id  TINYINT UNSIGNED NOT NULL COMMENT 'NC (07) o ND (08)',
  codigo_sunat         VARCHAR(2)   NOT NULL,
  descripcion          VARCHAR(150) NOT NULL,
  activo               TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_motivo_nota (tipo_comprobante_id, codigo_sunat),
  CONSTRAINT fk_motivo_nota_tcomp FOREIGN KEY (tipo_comprobante_id) REFERENCES tipo_comprobante (id)
) ENGINE=InnoDB COMMENT='SUNAT Cat.09 (NC) y Cat.10 (ND)';

-- Catálogo 07: tipo de afectación del IGV
CREATE TABLE tipo_afectacion_igv (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_sunat  CHAR(2)      NOT NULL,
  descripcion   VARCHAR(100) NOT NULL,
  grupo         ENUM('GRAVADO','EXONERADO','INAFECTO','EXPORTACION','GRATUITO') NOT NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tafec_codigo (codigo_sunat)
) ENGINE=InnoDB COMMENT='SUNAT Cat.07 - Afectación IGV';

-- Catálogo 03: unidad de medida
CREATE TABLE unidad_medida (
  id            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_sunat  VARCHAR(3)   NOT NULL COMMENT 'NIU, ZZ, KGM...',
  descripcion   VARCHAR(80)  NOT NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_um_codigo (codigo_sunat)
) ENGINE=InnoDB COMMENT='SUNAT Cat.03 - Unidad de medida';

-- Catálogo 02: moneda
CREATE TABLE moneda (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_iso    CHAR(3)      NOT NULL,
  descripcion   VARCHAR(50)  NOT NULL,
  simbolo       VARCHAR(5)   NOT NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_moneda_iso (codigo_iso)
) ENGINE=InnoDB COMMENT='Monedas ISO 4217';

CREATE TABLE tipo_cambio (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  moneda_id  TINYINT UNSIGNED NOT NULL,
  fecha      DATE          NOT NULL,
  compra     DECIMAL(10,4) NOT NULL,
  venta      DECIMAL(10,4) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tc_moneda_fecha (moneda_id, fecha),
  CONSTRAINT fk_tc_moneda FOREIGN KEY (moneda_id) REFERENCES moneda (id),
  CONSTRAINT ck_tc_positivo CHECK (compra > 0 AND venta > 0)
) ENGINE=InnoDB COMMENT='Tipo de cambio diario SBS/SUNAT';

CREATE TABLE metodo_pago (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        VARCHAR(20)  NOT NULL,
  descripcion   VARCHAR(60)  NOT NULL,
  es_efectivo   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = afecta saldo físico de caja',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mpago_codigo (codigo)
) ENGINE=InnoDB COMMENT='Efectivo, tarjeta, Yape, Plin, transferencia...';

CREATE TABLE ubigeo (
  codigo        CHAR(6)      NOT NULL COMMENT 'Código INEI',
  departamento  VARCHAR(50)  NOT NULL,
  provincia     VARCHAR(50)  NOT NULL,
  distrito      VARCHAR(80)  NOT NULL,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB COMMENT='Ubigeo INEI (exigido en dirección del emisor)';

CREATE TABLE pais (
  codigo        CHAR(2)      NOT NULL COMMENT 'ISO 3166-1 alfa-2',
  nombre        VARCHAR(80)  NOT NULL,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB COMMENT='Países (nacionalidad / procedencia del huésped)';

/* =====================================================================
   2. ORGANIZACIÓN Y SEGURIDAD (multiempresa, multisucursal, multiusuario)
   ===================================================================== */

CREATE TABLE empresa (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ruc                CHAR(11)     NOT NULL,
  razon_social       VARCHAR(200) NOT NULL,
  nombre_comercial   VARCHAR(200) NULL,
  direccion_fiscal   VARCHAR(250) NOT NULL,
  ubigeo_codigo      CHAR(6)      NOT NULL,
  telefono           VARCHAR(20)  NULL,
  email              VARCHAR(120) NULL,
  logo_ruta          VARCHAR(255) NULL,
  sunat_entorno      ENUM('BETA','PRODUCCION') NOT NULL DEFAULT 'BETA',
  sunat_usuario_sol  VARCHAR(30)  NULL COMMENT 'Usuario secundario SOL',
  sunat_clave_sol    VARBINARY(255) NULL COMMENT 'Cifrada con AES_ENCRYPT/KMS desde la app',
  ose_proveedor      VARCHAR(80)  NULL COMMENT 'Si se emite vía OSE en vez de SEE-SUNAT',
  igv_porcentaje     DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  activo             TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_empresa_ruc (ruc),
  CONSTRAINT fk_empresa_ubigeo FOREIGN KEY (ubigeo_codigo) REFERENCES ubigeo (codigo),
  CONSTRAINT ck_empresa_ruc CHECK (ruc REGEXP '^(10|15|17|20)[0-9]{9}$')
) ENGINE=InnoDB COMMENT='Emisor electrónico (contribuyente)';

CREATE TABLE certificado_digital (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id         INT UNSIGNED NOT NULL,
  alias              VARCHAR(80)  NOT NULL,
  archivo_ruta       VARCHAR(255) NOT NULL COMMENT 'Ruta/bóveda del .pfx/.p12; NO se guarda el binario en BD',
  clave_cifrada      VARBINARY(255) NOT NULL COMMENT 'Contraseña del PFX cifrada',
  numero_serie       VARCHAR(64)  NULL,
  emisor             VARCHAR(200) NULL COMMENT 'Entidad certificadora',
  fecha_emision      DATE         NOT NULL,
  fecha_vencimiento  DATE         NOT NULL,
  es_vigente         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cert_empresa_vig (empresa_id, es_vigente, fecha_vencimiento),
  CONSTRAINT fk_cert_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT ck_cert_fechas CHECK (fecha_vencimiento > fecha_emision)
) ENGINE=InnoDB COMMENT='Certificado digital para firmar XML (UBL 2.1)';

CREATE TABLE sucursal (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id            INT UNSIGNED NOT NULL,
  codigo_establecimiento CHAR(4)     NOT NULL DEFAULT '0000' COMMENT 'Código de anexo SUNAT (0000 = domicilio fiscal)',
  nombre                VARCHAR(120) NOT NULL,
  tipo                  ENUM('HOTEL','HOSTAL','APART') NOT NULL DEFAULT 'HOTEL',
  direccion             VARCHAR(250) NOT NULL,
  ubigeo_codigo         CHAR(6)      NOT NULL,
  telefono              VARCHAR(20)  NULL,
  hora_checkin          TIME         NOT NULL DEFAULT '14:00:00',
  hora_checkout         TIME         NOT NULL DEFAULT '12:00:00',
  activo                TINYINT(1)   NOT NULL DEFAULT 1,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sucursal_estab (empresa_id, codigo_establecimiento),
  CONSTRAINT fk_sucursal_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT fk_sucursal_ubigeo FOREIGN KEY (ubigeo_codigo) REFERENCES ubigeo (codigo)
) ENGINE=InnoDB COMMENT='Establecimiento / local (hotel u hostal)';

CREATE TABLE rol (
  id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre       VARCHAR(50)  NOT NULL,
  descripcion  VARCHAR(200) NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rol_nombre (nombre)
) ENGINE=InnoDB COMMENT='Perfil de acceso';

CREATE TABLE permiso (
  id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo       VARCHAR(60)  NOT NULL COMMENT 'ej. reserva.crear, caja.cerrar',
  modulo       VARCHAR(40)  NOT NULL,
  descripcion  VARCHAR(200) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permiso_codigo (codigo)
) ENGINE=InnoDB COMMENT='Acción atómica autorizable';

CREATE TABLE rol_permiso (
  rol_id      SMALLINT UNSIGNED NOT NULL,
  permiso_id  SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (rol_id, permiso_id),
  KEY ix_rp_permiso (permiso_id),
  CONSTRAINT fk_rp_rol     FOREIGN KEY (rol_id)     REFERENCES rol (id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permiso FOREIGN KEY (permiso_id) REFERENCES permiso (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='N:M rol-permiso';

CREATE TABLE usuario (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id       INT UNSIGNED NOT NULL,
  rol_id           SMALLINT UNSIGNED NOT NULL,
  username         VARCHAR(50)  NOT NULL,
  password_hash    VARCHAR(255) NOT NULL COMMENT 'bcrypt/argon2; nunca texto plano',
  nombres          VARCHAR(100) NOT NULL,
  apellidos        VARCHAR(100) NOT NULL,
  email            VARCHAR(120) NULL,
  ultimo_acceso    DATETIME     NULL,
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  activo           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuario_username (empresa_id, username),
  KEY ix_usuario_rol (rol_id),
  CONSTRAINT fk_usuario_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT fk_usuario_rol     FOREIGN KEY (rol_id)     REFERENCES rol (id)
) ENGINE=InnoDB COMMENT='Usuarios del sistema';

CREATE TABLE usuario_sucursal (
  usuario_id   INT UNSIGNED NOT NULL,
  sucursal_id  INT UNSIGNED NOT NULL,
  es_principal TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (usuario_id, sucursal_id),
  KEY ix_us_sucursal (sucursal_id),
  CONSTRAINT fk_us_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuario (id) ON DELETE CASCADE,
  CONSTRAINT fk_us_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Sucursales a las que accede cada usuario';

CREATE TABLE auditoria (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id   INT UNSIGNED NULL,
  tabla        VARCHAR(64)  NOT NULL,
  registro_id  BIGINT UNSIGNED NOT NULL,
  accion       ENUM('INSERT','UPDATE','DELETE','ANULAR','LOGIN') NOT NULL,
  datos_antes  JSON NULL,
  datos_despues JSON NULL,
  ip           VARCHAR(45)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_aud_tabla_reg (tabla, registro_id),
  KEY ix_aud_fecha (created_at),
  CONSTRAINT fk_aud_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
) ENGINE=InnoDB COMMENT='Bitácora de cambios sensibles';

/* =====================================================================
   3. TERCEROS: CLIENTES / HUÉSPEDES Y PROVEEDORES
   ===================================================================== */

CREATE TABLE cliente (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id             INT UNSIGNED NOT NULL,
  tipo_documento_id      TINYINT UNSIGNED NOT NULL,
  numero_documento       VARCHAR(15)  NOT NULL,
  razon_social           VARCHAR(200) NULL COMMENT 'Para RUC',
  nombres                VARCHAR(100) NULL,
  apellidos              VARCHAR(100) NULL,
  nombre_completo        VARCHAR(250) AS (COALESCE(razon_social, CONCAT_WS(' ', nombres, apellidos))) STORED,
  direccion              VARCHAR(250) NULL,
  pais_codigo            CHAR(2)      NOT NULL DEFAULT 'PE' COMMENT 'Nacionalidad',
  fecha_nacimiento       DATE         NULL,
  sexo                   ENUM('M','F','X') NULL,
  telefono               VARCHAR(20)  NULL,
  email                  VARCHAR(120) NULL,
  observaciones          VARCHAR(500) NULL,
  activo                 TINYINT(1)   NOT NULL DEFAULT 1,
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cliente_doc (empresa_id, tipo_documento_id, numero_documento),
  KEY ix_cliente_nombre (nombre_completo),
  KEY ix_cliente_tdi (tipo_documento_id),
  KEY ix_cliente_pais (pais_codigo),
  CONSTRAINT fk_cliente_empresa FOREIGN KEY (empresa_id)        REFERENCES empresa (id),
  CONSTRAINT fk_cliente_tdi     FOREIGN KEY (tipo_documento_id) REFERENCES tipo_documento_identidad (id),
  CONSTRAINT fk_cliente_pais    FOREIGN KEY (pais_codigo)       REFERENCES pais (codigo),
  CONSTRAINT ck_cliente_nombre  CHECK (razon_social IS NOT NULL OR nombres IS NOT NULL)
) ENGINE=InnoDB COMMENT='Cliente de facturación y/o huésped (una sola entidad persona)';

CREATE TABLE proveedor (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id         INT UNSIGNED NOT NULL,
  tipo_documento_id  TINYINT UNSIGNED NOT NULL,
  numero_documento   VARCHAR(15)  NOT NULL,
  razon_social       VARCHAR(200) NOT NULL,
  direccion          VARCHAR(250) NULL,
  telefono           VARCHAR(20)  NULL,
  email              VARCHAR(120) NULL,
  contacto           VARCHAR(120) NULL,
  activo             TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_proveedor_doc (empresa_id, tipo_documento_id, numero_documento),
  KEY ix_proveedor_tdi (tipo_documento_id),
  CONSTRAINT fk_proveedor_empresa FOREIGN KEY (empresa_id)        REFERENCES empresa (id),
  CONSTRAINT fk_proveedor_tdi     FOREIGN KEY (tipo_documento_id) REFERENCES tipo_documento_identidad (id)
) ENGINE=InnoDB COMMENT='Proveedores';

/* =====================================================================
   4. MÓDULO HOTEL / RESERVAS
   ===================================================================== */

CREATE TABLE piso (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id  INT UNSIGNED NOT NULL,
  numero       SMALLINT     NOT NULL COMMENT 'Puede ser negativo (sótano)',
  nombre       VARCHAR(50)  NOT NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_piso (sucursal_id, numero),
  CONSTRAINT fk_piso_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id)
) ENGINE=InnoDB COMMENT='Control de pisos';

CREATE TABLE tipo_habitacion (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id       INT UNSIGNED NOT NULL,
  nombre           VARCHAR(60)  NOT NULL COMMENT 'Simple, Doble, Matrimonial, Suite',
  descripcion      VARCHAR(300) NULL,
  capacidad_adultos TINYINT UNSIGNED NOT NULL DEFAULT 1,
  capacidad_ninos  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  activo           TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_thab_nombre (empresa_id, nombre),
  CONSTRAINT fk_thab_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT ck_thab_capacidad CHECK (capacidad_adultos >= 1)
) ENGINE=InnoDB COMMENT='Control de tipo de habitación';

CREATE TABLE estado_habitacion (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        VARCHAR(20)  NOT NULL,
  descripcion   VARCHAR(60)  NOT NULL,
  color_hex     CHAR(7)      NOT NULL DEFAULT '#9E9E9E' COMMENT 'Color en el tablero (rack)',
  permite_venta TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = se puede asignar a un huésped',
  orden         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ehab_codigo (codigo)
) ENGINE=InnoDB COMMENT='Desocupada, Reservada, Confirmada, Ocupada, Limpieza, Mantenimiento';

CREATE TABLE habitacion (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id           INT UNSIGNED NOT NULL,
  piso_id               INT UNSIGNED NOT NULL,
  tipo_habitacion_id    INT UNSIGNED NOT NULL,
  estado_habitacion_id  TINYINT UNSIGNED NOT NULL,
  numero                VARCHAR(10)  NOT NULL,
  descripcion           VARCHAR(300) NULL,
  activo                TINYINT(1)   NOT NULL DEFAULT 1,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_habitacion_num (sucursal_id, numero),
  KEY ix_hab_piso (piso_id),
  KEY ix_hab_tipo (tipo_habitacion_id),
  KEY ix_hab_estado (sucursal_id, estado_habitacion_id),
  CONSTRAINT fk_hab_sucursal FOREIGN KEY (sucursal_id)          REFERENCES sucursal (id),
  CONSTRAINT fk_hab_piso     FOREIGN KEY (piso_id)              REFERENCES piso (id),
  CONSTRAINT fk_hab_tipo     FOREIGN KEY (tipo_habitacion_id)   REFERENCES tipo_habitacion (id),
  CONSTRAINT fk_hab_estado   FOREIGN KEY (estado_habitacion_id) REFERENCES estado_habitacion (id)
) ENGINE=InnoDB COMMENT='Control de habitaciones';

CREATE TABLE habitacion_estado_historial (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  habitacion_id          INT UNSIGNED NOT NULL,
  estado_anterior_id     TINYINT UNSIGNED NULL,
  estado_nuevo_id        TINYINT UNSIGNED NOT NULL,
  usuario_id             INT UNSIGNED NULL,
  motivo                 VARCHAR(200) NULL,
  fecha_hora             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_heh_hab_fecha (habitacion_id, fecha_hora),
  CONSTRAINT fk_heh_hab     FOREIGN KEY (habitacion_id)      REFERENCES habitacion (id),
  CONSTRAINT fk_heh_ant     FOREIGN KEY (estado_anterior_id) REFERENCES estado_habitacion (id),
  CONSTRAINT fk_heh_nuevo   FOREIGN KEY (estado_nuevo_id)    REFERENCES estado_habitacion (id),
  CONSTRAINT fk_heh_usuario FOREIGN KEY (usuario_id)         REFERENCES usuario (id)
) ENGINE=InnoDB COMMENT='Trazabilidad de cambios de estado (lo llena un trigger)';

CREATE TABLE canal_venta (
  id                   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           INT UNSIGNED NOT NULL,
  nombre               VARCHAR(60)  NOT NULL COMMENT 'Directo/Recepción, Booking, Airbnb, Expedia, Web',
  comision_porcentaje  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  es_ota               TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Online Travel Agency',
  activo               TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_canal_nombre (empresa_id, nombre),
  CONSTRAINT fk_canal_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT ck_canal_comision CHECK (comision_porcentaje BETWEEN 0 AND 100)
) ENGINE=InnoDB COMMENT='Canal de venta';

CREATE TABLE turno (
  id              TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(30)  NOT NULL,
  duracion_horas  TINYINT UNSIGNED NOT NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_turno_horas (duracion_horas),
  CONSTRAINT ck_turno_horas CHECK (duracion_horas BETWEEN 1 AND 24)
) ENGINE=InnoDB COMMENT='Turnos de alquiler: 24h, 12h, 6h, 3h';

CREATE TABLE tarifa (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id         INT UNSIGNED NOT NULL,
  tipo_habitacion_id  INT UNSIGNED NOT NULL,
  canal_venta_id      SMALLINT UNSIGNED NOT NULL,
  turno_id            TINYINT UNSIGNED NOT NULL,
  moneda_id           TINYINT UNSIGNED NOT NULL,
  precio              DECIMAL(14,2) NOT NULL COMMENT 'Precio con IGV',
  vigente_desde       DATE          NOT NULL,
  vigente_hasta       DATE          NULL COMMENT 'NULL = sin fecha de fin',
  activo              TINYINT(1)    NOT NULL DEFAULT 1,
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tarifa (sucursal_id, tipo_habitacion_id, canal_venta_id, turno_id, vigente_desde),
  KEY ix_tarifa_busqueda (sucursal_id, tipo_habitacion_id, canal_venta_id, turno_id, activo, vigente_desde),
  KEY ix_tarifa_tipo (tipo_habitacion_id),
  KEY ix_tarifa_canal (canal_venta_id),
  KEY ix_tarifa_turno (turno_id),
  CONSTRAINT fk_tarifa_sucursal FOREIGN KEY (sucursal_id)        REFERENCES sucursal (id),
  CONSTRAINT fk_tarifa_thab     FOREIGN KEY (tipo_habitacion_id) REFERENCES tipo_habitacion (id),
  CONSTRAINT fk_tarifa_canal    FOREIGN KEY (canal_venta_id)     REFERENCES canal_venta (id),
  CONSTRAINT fk_tarifa_turno    FOREIGN KEY (turno_id)           REFERENCES turno (id),
  CONSTRAINT fk_tarifa_moneda   FOREIGN KEY (moneda_id)          REFERENCES moneda (id),
  CONSTRAINT ck_tarifa_precio   CHECK (precio >= 0),
  CONSTRAINT ck_tarifa_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
) ENGINE=InnoDB COMMENT='Precios dinámicos: sucursal × tipo hab. × canal × turno × vigencia';

CREATE TABLE reserva (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id           INT UNSIGNED NOT NULL,
  codigo                VARCHAR(20)  NOT NULL COMMENT 'Código interno legible, ej. R-2026-000123',
  cliente_id            BIGINT UNSIGNED NOT NULL COMMENT 'Titular de la reserva',
  canal_venta_id        SMALLINT UNSIGNED NOT NULL,
  codigo_externo        VARCHAR(50)  NULL COMMENT 'Nº de reserva en Booking/Airbnb',
  fecha_entrada         DATETIME     NOT NULL,
  fecha_salida          DATETIME     NOT NULL,
  adultos               TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ninos                 TINYINT UNSIGNED NOT NULL DEFAULT 0,
  estado                ENUM('PENDIENTE','CONFIRMADA','EN_CURSO','FINALIZADA','CANCELADA','NO_SHOW') NOT NULL DEFAULT 'PENDIENTE',
  moneda_id             TINYINT UNSIGNED NOT NULL,
  monto_total           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  monto_adelanto        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  observaciones         VARCHAR(500) NULL,
  motivo_cancelacion    VARCHAR(250) NULL,
  usuario_id            INT UNSIGNED NOT NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reserva_codigo (sucursal_id, codigo),
  KEY ix_reserva_fechas (sucursal_id, fecha_entrada, fecha_salida),
  KEY ix_reserva_estado (sucursal_id, estado),
  KEY ix_reserva_cliente (cliente_id),
  KEY ix_reserva_canal (canal_venta_id),
  KEY ix_reserva_ext (canal_venta_id, codigo_externo),
  CONSTRAINT fk_reserva_sucursal FOREIGN KEY (sucursal_id)    REFERENCES sucursal (id),
  CONSTRAINT fk_reserva_cliente  FOREIGN KEY (cliente_id)     REFERENCES cliente (id),
  CONSTRAINT fk_reserva_canal    FOREIGN KEY (canal_venta_id) REFERENCES canal_venta (id),
  CONSTRAINT fk_reserva_moneda   FOREIGN KEY (moneda_id)      REFERENCES moneda (id),
  CONSTRAINT fk_reserva_usuario  FOREIGN KEY (usuario_id)     REFERENCES usuario (id),
  CONSTRAINT ck_reserva_fechas   CHECK (fecha_salida > fecha_entrada),
  CONSTRAINT ck_reserva_montos   CHECK (monto_total >= 0 AND monto_adelanto >= 0 AND monto_adelanto <= monto_total)
) ENGINE=InnoDB COMMENT='Cabecera de reserva';

CREATE TABLE reserva_habitacion (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reserva_id       BIGINT UNSIGNED NOT NULL,
  habitacion_id    INT UNSIGNED NOT NULL,
  tarifa_id        INT UNSIGNED NULL COMMENT 'Tarifa de origen (referencial)',
  turno_id         TINYINT UNSIGNED NOT NULL,
  fecha_entrada    DATETIME     NOT NULL,
  fecha_salida     DATETIME     NOT NULL,
  cantidad_turnos  SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Noches o bloques de horas',
  precio_unitario  DECIMAL(14,2) NOT NULL COMMENT 'Precio pactado (congelado)',
  subtotal         DECIMAL(14,2) AS (precio_unitario * cantidad_turnos) STORED,
  estado           ENUM('ACTIVA','CANCELADA') NOT NULL DEFAULT 'ACTIVA',
  PRIMARY KEY (id),
  KEY ix_rh_reserva (reserva_id),
  KEY ix_rh_hab_fechas (habitacion_id, fecha_entrada, fecha_salida),
  KEY ix_rh_tarifa (tarifa_id),
  KEY ix_rh_turno (turno_id),
  CONSTRAINT fk_rh_reserva FOREIGN KEY (reserva_id)    REFERENCES reserva (id) ON DELETE CASCADE,
  CONSTRAINT fk_rh_hab     FOREIGN KEY (habitacion_id) REFERENCES habitacion (id),
  CONSTRAINT fk_rh_tarifa  FOREIGN KEY (tarifa_id)     REFERENCES tarifa (id),
  CONSTRAINT fk_rh_turno   FOREIGN KEY (turno_id)      REFERENCES turno (id),
  CONSTRAINT ck_rh_fechas  CHECK (fecha_salida > fecha_entrada),
  CONSTRAINT ck_rh_precio  CHECK (precio_unitario >= 0 AND cantidad_turnos >= 1)
) ENGINE=InnoDB COMMENT='Habitaciones incluidas en la reserva';

CREATE TABLE estancia (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id            INT UNSIGNED NOT NULL,
  habitacion_id          INT UNSIGNED NOT NULL,
  reserva_habitacion_id  BIGINT UNSIGNED NULL COMMENT 'NULL = walk-in sin reserva',
  canal_venta_id         SMALLINT UNSIGNED NOT NULL,
  turno_id               TINYINT UNSIGNED NOT NULL,
  checkin_at             DATETIME     NOT NULL,
  checkout_previsto      DATETIME     NOT NULL,
  checkout_at            DATETIME     NULL COMMENT 'Salida real',
  cantidad_turnos        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  precio_unitario        DECIMAL(14,2) NOT NULL,
  monto_hospedaje        DECIMAL(14,2) AS (precio_unitario * cantidad_turnos) STORED,
  procedencia            VARCHAR(100) NULL COMMENT 'Ciudad/país de procedencia (libro de huéspedes)',
  destino                VARCHAR(100) NULL,
  motivo_viaje           VARCHAR(60)  NULL,
  placa_vehiculo         VARCHAR(10)  NULL,
  estado                 ENUM('ACTIVA','FINALIZADA','ANULADA') NOT NULL DEFAULT 'ACTIVA',
  usuario_checkin_id     INT UNSIGNED NOT NULL,
  usuario_checkout_id    INT UNSIGNED NULL,
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_est_hab_fechas (habitacion_id, checkin_at, checkout_previsto),
  KEY ix_est_suc_checkin (sucursal_id, checkin_at),
  KEY ix_est_estado (sucursal_id, estado),
  KEY ix_est_rh (reserva_habitacion_id),
  KEY ix_est_canal (canal_venta_id),
  KEY ix_est_turno (turno_id),
  CONSTRAINT fk_est_sucursal FOREIGN KEY (sucursal_id)           REFERENCES sucursal (id),
  CONSTRAINT fk_est_hab      FOREIGN KEY (habitacion_id)         REFERENCES habitacion (id),
  CONSTRAINT fk_est_rh       FOREIGN KEY (reserva_habitacion_id) REFERENCES reserva_habitacion (id),
  CONSTRAINT fk_est_canal    FOREIGN KEY (canal_venta_id)        REFERENCES canal_venta (id),
  CONSTRAINT fk_est_turno    FOREIGN KEY (turno_id)              REFERENCES turno (id),
  CONSTRAINT fk_est_uci      FOREIGN KEY (usuario_checkin_id)    REFERENCES usuario (id),
  CONSTRAINT fk_est_uco      FOREIGN KEY (usuario_checkout_id)   REFERENCES usuario (id),
  CONSTRAINT ck_est_fechas   CHECK (checkout_previsto > checkin_at AND (checkout_at IS NULL OR checkout_at >= checkin_at))
) ENGINE=InnoDB COMMENT='Hospedaje efectivo (check-in / check-out)';

CREATE TABLE estancia_huesped (
  estancia_id  BIGINT UNSIGNED NOT NULL,
  cliente_id   BIGINT UNSIGNED NOT NULL,
  es_titular   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (estancia_id, cliente_id),
  KEY ix_eh_cliente (cliente_id),
  CONSTRAINT fk_eh_estancia FOREIGN KEY (estancia_id) REFERENCES estancia (id) ON DELETE CASCADE,
  CONSTRAINT fk_eh_cliente  FOREIGN KEY (cliente_id)  REFERENCES cliente (id)
) ENGINE=InnoDB COMMENT='Huéspedes alojados (libro de registro de huéspedes)';

/* =====================================================================
   5. PRODUCTOS, COMPRAS E INVENTARIO
   ===================================================================== */

CREATE TABLE categoria_producto (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id  INT UNSIGNED NOT NULL,
  nombre      VARCHAR(80)  NOT NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_catprod (empresa_id, nombre),
  CONSTRAINT fk_catprod_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id)
) ENGINE=InnoDB COMMENT='Minibar, Lavandería, Cafetería, Insumos...';

CREATE TABLE producto (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id             INT UNSIGNED NOT NULL,
  categoria_id           SMALLINT UNSIGNED NOT NULL,
  codigo                 VARCHAR(30)  NOT NULL,
  codigo_sunat           VARCHAR(8)   NULL COMMENT 'Código de producto SUNAT (UNSPSC)',
  nombre                 VARCHAR(200) NOT NULL,
  tipo                   ENUM('BIEN','SERVICIO') NOT NULL DEFAULT 'BIEN',
  unidad_medida_id       SMALLINT UNSIGNED NOT NULL,
  tipo_afectacion_igv_id TINYINT UNSIGNED NOT NULL,
  precio_venta           DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Con IGV',
  costo_promedio         DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  controla_stock         TINYINT(1)   NOT NULL DEFAULT 1,
  stock_minimo           DECIMAL(12,3) NOT NULL DEFAULT 0,
  es_hospedaje           TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = servicio de alojamiento',
  activo                 TINYINT(1)   NOT NULL DEFAULT 1,
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_producto_codigo (empresa_id, codigo),
  KEY ix_producto_nombre (nombre),
  KEY ix_producto_cat (categoria_id),
  KEY ix_producto_um (unidad_medida_id),
  KEY ix_producto_afec (tipo_afectacion_igv_id),
  CONSTRAINT fk_producto_empresa FOREIGN KEY (empresa_id)             REFERENCES empresa (id),
  CONSTRAINT fk_producto_cat     FOREIGN KEY (categoria_id)           REFERENCES categoria_producto (id),
  CONSTRAINT fk_producto_um      FOREIGN KEY (unidad_medida_id)       REFERENCES unidad_medida (id),
  CONSTRAINT fk_producto_afec    FOREIGN KEY (tipo_afectacion_igv_id) REFERENCES tipo_afectacion_igv (id),
  CONSTRAINT ck_producto_precio  CHECK (precio_venta >= 0 AND costo_promedio >= 0)
) ENGINE=InnoDB COMMENT='Bienes y servicios vendibles/comprables';

CREATE TABLE producto_stock (
  sucursal_id  INT UNSIGNED NOT NULL,
  producto_id  INT UNSIGNED NOT NULL,
  stock        DECIMAL(12,3) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sucursal_id, producto_id),
  KEY ix_ps_producto (producto_id),
  CONSTRAINT fk_ps_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id),
  CONSTRAINT fk_ps_producto FOREIGN KEY (producto_id) REFERENCES producto (id)
) ENGINE=InnoDB COMMENT='Saldo de stock por sucursal (mantenido por trigger de kardex)';

CREATE TABLE compra (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id           INT UNSIGNED NOT NULL,
  proveedor_id          INT UNSIGNED NOT NULL,
  tipo_comprobante_id   TINYINT UNSIGNED NOT NULL COMMENT 'Factura, boleta, guía, etc.',
  serie                 VARCHAR(4)   NOT NULL,
  numero                VARCHAR(10)  NOT NULL,
  fecha_emision         DATE         NOT NULL,
  fecha_registro        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  moneda_id             TINYINT UNSIGNED NOT NULL,
  tipo_cambio           DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
  subtotal              DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Base imponible',
  igv                   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total                 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  guia_remision         VARCHAR(20)  NULL COMMENT 'Serie-número de guía asociada',
  estado                ENUM('REGISTRADA','ANULADA') NOT NULL DEFAULT 'REGISTRADA',
  observaciones         VARCHAR(500) NULL,
  usuario_id            INT UNSIGNED NOT NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_compra_doc (proveedor_id, tipo_comprobante_id, serie, numero),
  KEY ix_compra_fecha (sucursal_id, fecha_emision),
  KEY ix_compra_tcomp (tipo_comprobante_id),
  CONSTRAINT fk_compra_sucursal  FOREIGN KEY (sucursal_id)         REFERENCES sucursal (id),
  CONSTRAINT fk_compra_proveedor FOREIGN KEY (proveedor_id)        REFERENCES proveedor (id),
  CONSTRAINT fk_compra_tcomp     FOREIGN KEY (tipo_comprobante_id) REFERENCES tipo_comprobante (id),
  CONSTRAINT fk_compra_moneda    FOREIGN KEY (moneda_id)           REFERENCES moneda (id),
  CONSTRAINT fk_compra_usuario   FOREIGN KEY (usuario_id)          REFERENCES usuario (id),
  CONSTRAINT ck_compra_totales   CHECK (total >= 0 AND total = subtotal + igv)
) ENGINE=InnoDB COMMENT='Registro de compras por factura/boleta/guía';

CREATE TABLE compra_detalle (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  compra_id        BIGINT UNSIGNED NOT NULL,
  producto_id      INT UNSIGNED NOT NULL,
  cantidad         DECIMAL(12,3) NOT NULL,
  costo_unitario   DECIMAL(14,4) NOT NULL COMMENT 'Sin IGV',
  igv              DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  subtotal         DECIMAL(14,2) NOT NULL COMMENT 'cantidad * costo_unitario',
  PRIMARY KEY (id),
  KEY ix_cd_compra (compra_id),
  KEY ix_cd_producto (producto_id),
  CONSTRAINT fk_cd_compra   FOREIGN KEY (compra_id)   REFERENCES compra (id) ON DELETE CASCADE,
  CONSTRAINT fk_cd_producto FOREIGN KEY (producto_id) REFERENCES producto (id),
  CONSTRAINT ck_cd_valores  CHECK (cantidad > 0 AND costo_unitario >= 0)
) ENGINE=InnoDB COMMENT='Ítems de la compra';

CREATE TABLE movimiento_inventario (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id      INT UNSIGNED NOT NULL,
  producto_id      INT UNSIGNED NOT NULL,
  concepto_movimiento_id SMALLINT UNSIGNED NOT NULL COMMENT 'Define si es INGRESO o EGRESO de stock',
  cantidad         DECIMAL(12,3) NOT NULL,
  costo_unitario   DECIMAL(14,4) NOT NULL DEFAULT 0,
  compra_detalle_id      BIGINT UNSIGNED NULL,
  comprobante_detalle_id BIGINT UNSIGNED NULL,
  observacion      VARCHAR(200) NULL,
  usuario_id       INT UNSIGNED NOT NULL,
  fecha_hora       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mi_kardex (sucursal_id, producto_id, fecha_hora),
  KEY ix_mi_producto (producto_id),
  KEY ix_mi_cd (compra_detalle_id),
  KEY ix_mi_vd (comprobante_detalle_id),
  KEY ix_mi_concepto (concepto_movimiento_id),
  CONSTRAINT fk_mi_concepto FOREIGN KEY (concepto_movimiento_id) REFERENCES concepto_movimiento (id),
  CONSTRAINT fk_mi_sucursal FOREIGN KEY (sucursal_id)       REFERENCES sucursal (id),
  CONSTRAINT fk_mi_producto FOREIGN KEY (producto_id)       REFERENCES producto (id),
  CONSTRAINT fk_mi_cd       FOREIGN KEY (compra_detalle_id) REFERENCES compra_detalle (id),
  CONSTRAINT fk_mi_usuario  FOREIGN KEY (usuario_id)        REFERENCES usuario (id),
  CONSTRAINT ck_mi_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB COMMENT='Kardex: toda entrada/salida de stock';

/* =====================================================================
   6. CAJA
   ===================================================================== */

CREATE TABLE caja (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id  INT UNSIGNED NOT NULL,
  nombre       VARCHAR(60)  NOT NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_caja (sucursal_id, nombre),
  CONSTRAINT fk_caja_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursal (id)
) ENGINE=InnoDB COMMENT='Punto de cobro físico (recepción)';

CREATE TABLE caja_sesion (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  caja_id               INT UNSIGNED NOT NULL,
  usuario_id            INT UNSIGNED NOT NULL COMMENT 'Cajero',
  fecha_apertura        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto_apertura        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  fecha_cierre          DATETIME     NULL,
  monto_cierre_sistema  DECIMAL(14,2) NULL COMMENT 'Efectivo esperado calculado',
  monto_cierre_declarado DECIMAL(14,2) NULL COMMENT 'Efectivo contado por el cajero',
  diferencia            DECIMAL(14,2) AS (monto_cierre_declarado - monto_cierre_sistema) STORED,
  estado                ENUM('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  observaciones         VARCHAR(500) NULL,
  -- Columna auxiliar: solo 1 sesión ABIERTA por caja (NULL no colisiona en UNIQUE)
  caja_abierta          INT UNSIGNED AS (IF(estado = 'ABIERTA', caja_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cs_una_abierta (caja_abierta),
  KEY ix_cs_caja_fecha (caja_id, fecha_apertura),
  KEY ix_cs_usuario (usuario_id, fecha_apertura),
  CONSTRAINT fk_cs_caja    FOREIGN KEY (caja_id)    REFERENCES caja (id),
  CONSTRAINT fk_cs_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id),
  CONSTRAINT ck_cs_cierre  CHECK (estado = 'ABIERTA' OR fecha_cierre IS NOT NULL)
) ENGINE=InnoDB COMMENT='Turno de caja (apertura/cierre) para liquidación del cajero';

/* =====================================================================
   7. FACTURACIÓN ELECTRÓNICA / VENTAS
   ===================================================================== */

CREATE TABLE serie (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id          INT UNSIGNED NOT NULL,
  tipo_comprobante_id  TINYINT UNSIGNED NOT NULL,
  serie                CHAR(4)      NOT NULL COMMENT 'F001, B001, FC01, BD01...',
  correlativo_actual   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Último número emitido',
  es_contingencia      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Series 0001 físicas de contingencia',
  activo               TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_serie (sucursal_id, tipo_comprobante_id, serie),
  KEY ix_serie_tcomp (tipo_comprobante_id),
  CONSTRAINT fk_serie_sucursal FOREIGN KEY (sucursal_id)         REFERENCES sucursal (id),
  CONSTRAINT fk_serie_tcomp    FOREIGN KEY (tipo_comprobante_id) REFERENCES tipo_comprobante (id),
  CONSTRAINT ck_serie_formato  CHECK (serie REGEXP '^[A-Z0-9]{4}$'),
  CONSTRAINT ck_serie_corr     CHECK (correlativo_actual <= 99999999)
) ENGINE=InnoDB COMMENT='Números de serie y correlativo por sucursal y tipo';

CREATE TABLE usuario_serie (
  usuario_id  INT UNSIGNED NOT NULL,
  serie_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, serie_id),
  KEY ix_useries_serie (serie_id),
  CONSTRAINT fk_useries_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE,
  CONSTRAINT fk_useries_serie   FOREIGN KEY (serie_id)   REFERENCES serie (id)   ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Series que puede usar cada usuario (multiusuario)';

CREATE TABLE descuento (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id       INT UNSIGNED NOT NULL,
  nombre           VARCHAR(80)  NOT NULL,
  tipo             ENUM('PORCENTAJE','MONTO') NOT NULL,
  valor            DECIMAL(12,2) NOT NULL,
  monto_minimo     DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Total mínimo para aplicar',
  requiere_autorizacion TINYINT(1) NOT NULL DEFAULT 0,
  vigente_desde    DATE         NOT NULL,
  vigente_hasta    DATE         NULL,
  activo           TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_descuento (empresa_id, nombre),
  CONSTRAINT fk_descuento_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT ck_descuento_valor   CHECK (valor > 0 AND (tipo = 'MONTO' OR valor <= 100)),
  CONSTRAINT ck_descuento_vig     CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
) ENGINE=InnoDB COMMENT='Descuentos globales aplicables al total del comprobante';

CREATE TABLE comprobante (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sucursal_id           INT UNSIGNED NOT NULL,
  serie_id              INT UNSIGNED NOT NULL,
  tipo_comprobante_id   TINYINT UNSIGNED NOT NULL,
  serie                 CHAR(4)      NOT NULL COMMENT 'Desnormalizado por inmutabilidad',
  numero                INT UNSIGNED NOT NULL,
  fecha_emision         DATE         NOT NULL,
  hora_emision          TIME         NOT NULL,
  fecha_vencimiento     DATE         NULL,
  forma_pago            ENUM('CONTADO','CREDITO') NOT NULL DEFAULT 'CONTADO',
  cliente_id            BIGINT UNSIGNED NOT NULL,
  -- Snapshot del receptor (el XML debe reflejar los datos al momento de emisión)
  cliente_tipo_doc      CHAR(1)      NOT NULL,
  cliente_num_doc       VARCHAR(15)  NOT NULL,
  cliente_nombre        VARCHAR(250) NOT NULL,
  cliente_direccion     VARCHAR(250) NULL,
  moneda_id             TINYINT UNSIGNED NOT NULL,
  tipo_cambio           DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
  estancia_id           BIGINT UNSIGNED NULL COMMENT 'Hospedaje facturado',
  reserva_id            BIGINT UNSIGNED NULL COMMENT 'Adelanto de reserva',
  caja_sesion_id        BIGINT UNSIGNED NULL,
  descuento_id          INT UNSIGNED NULL,
  -- Nota de crédito / débito
  comprobante_ref_id    BIGINT UNSIGNED NULL COMMENT 'Documento que modifica',
  motivo_nota_id        TINYINT UNSIGNED NULL,
  sustento_nota         VARCHAR(250) NULL,
  -- Totales (UBL 2.1)
  total_gravada         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_exonerada       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_inafecta        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_gratuita        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  descuento_global      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_igv             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_icbper          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total                 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  monto_letras          VARCHAR(250) NULL,
  -- Estado SUNAT
  estado_sunat          ENUM('PENDIENTE','ENVIADO','ACEPTADO','OBSERVADO','RECHAZADO','ANULADO','POR_ANULAR','NO_APLICA')
                        NOT NULL DEFAULT 'PENDIENTE' COMMENT 'NO_APLICA = comprobante INTERNO (no va a SUNAT)',
  hash_cpe              VARCHAR(100) NULL COMMENT 'DigestValue de la firma',
  xml_nombre            VARCHAR(100) NULL COMMENT 'RUC-TT-SERIE-NUMERO.xml',
  xml_ruta              VARCHAR(255) NULL,
  cdr_ruta              VARCHAR(255) NULL COMMENT 'R-RUC-TT-SERIE-NUMERO.zip',
  cdr_codigo            VARCHAR(10)  NULL COMMENT '0 = aceptado; 2000-3999 rechazo; 4000+ observación',
  cdr_descripcion       VARCHAR(500) NULL,
  fecha_envio_sunat     DATETIME     NULL,
  observaciones         VARCHAR(500) NULL,
  usuario_id            INT UNSIGNED NOT NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_comprobante_num (serie_id, numero),
  KEY ix_comp_fecha (sucursal_id, fecha_emision),
  KEY ix_comp_tipo_fecha (tipo_comprobante_id, fecha_emision),
  KEY ix_comp_estado (estado_sunat, fecha_emision),
  KEY ix_comp_cliente (cliente_id),
  KEY ix_comp_cliente_doc (cliente_num_doc),
  KEY ix_comp_estancia (estancia_id),
  KEY ix_comp_reserva (reserva_id),
  KEY ix_comp_caja (caja_sesion_id),
  KEY ix_comp_ref (comprobante_ref_id),
  KEY ix_comp_desc (descuento_id),
  KEY ix_comp_motivo (motivo_nota_id),
  KEY ix_comp_moneda (moneda_id),
  KEY ix_comp_usuario (usuario_id),
  CONSTRAINT fk_comp_sucursal FOREIGN KEY (sucursal_id)         REFERENCES sucursal (id),
  CONSTRAINT fk_comp_serie    FOREIGN KEY (serie_id)            REFERENCES serie (id),
  CONSTRAINT fk_comp_tcomp    FOREIGN KEY (tipo_comprobante_id) REFERENCES tipo_comprobante (id),
  CONSTRAINT fk_comp_cliente  FOREIGN KEY (cliente_id)          REFERENCES cliente (id),
  CONSTRAINT fk_comp_moneda   FOREIGN KEY (moneda_id)           REFERENCES moneda (id),
  CONSTRAINT fk_comp_estancia FOREIGN KEY (estancia_id)         REFERENCES estancia (id),
  CONSTRAINT fk_comp_reserva  FOREIGN KEY (reserva_id)          REFERENCES reserva (id),
  CONSTRAINT fk_comp_caja     FOREIGN KEY (caja_sesion_id)      REFERENCES caja_sesion (id),
  CONSTRAINT fk_comp_desc     FOREIGN KEY (descuento_id)        REFERENCES descuento (id),
  CONSTRAINT fk_comp_ref      FOREIGN KEY (comprobante_ref_id)  REFERENCES comprobante (id),
  CONSTRAINT fk_comp_motivo   FOREIGN KEY (motivo_nota_id)      REFERENCES motivo_nota (id),
  CONSTRAINT fk_comp_usuario  FOREIGN KEY (usuario_id)          REFERENCES usuario (id),
  CONSTRAINT ck_comp_numero   CHECK (numero BETWEEN 1 AND 99999999),
  CONSTRAINT ck_comp_totales  CHECK (total >= 0 AND total_igv >= 0 AND descuento_global >= 0),
  CONSTRAINT ck_comp_credito  CHECK (forma_pago = 'CONTADO' OR fecha_vencimiento IS NOT NULL)
) ENGINE=InnoDB COMMENT='Comprobante de pago electrónico (cabecera): factura, boleta, NC, ND';

CREATE TABLE comprobante_detalle (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  comprobante_id         BIGINT UNSIGNED NOT NULL,
  item                   SMALLINT UNSIGNED NOT NULL COMMENT 'Nº de línea 1..n',
  producto_id            INT UNSIGNED NULL,
  estancia_id            BIGINT UNSIGNED NULL COMMENT 'Línea de hospedaje',
  descripcion            VARCHAR(500) NOT NULL,
  unidad_medida_id       SMALLINT UNSIGNED NOT NULL,
  tipo_afectacion_igv_id TINYINT UNSIGNED NOT NULL,
  cantidad               DECIMAL(12,3) NOT NULL,
  valor_unitario         DECIMAL(14,4) NOT NULL COMMENT 'Sin IGV',
  precio_unitario        DECIMAL(14,4) NOT NULL COMMENT 'Con IGV',
  descuento              DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  valor_venta            DECIMAL(14,2) NOT NULL COMMENT 'cantidad*valor_unitario - descuento',
  igv                    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total                  DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cdet_item (comprobante_id, item),
  KEY ix_cdet_producto (producto_id),
  KEY ix_cdet_estancia (estancia_id),
  KEY ix_cdet_um (unidad_medida_id),
  KEY ix_cdet_afec (tipo_afectacion_igv_id),
  CONSTRAINT fk_cdet_comp     FOREIGN KEY (comprobante_id)         REFERENCES comprobante (id),
  CONSTRAINT fk_cdet_producto FOREIGN KEY (producto_id)            REFERENCES producto (id),
  CONSTRAINT fk_cdet_estancia FOREIGN KEY (estancia_id)            REFERENCES estancia (id),
  CONSTRAINT fk_cdet_um       FOREIGN KEY (unidad_medida_id)       REFERENCES unidad_medida (id),
  CONSTRAINT fk_cdet_afec     FOREIGN KEY (tipo_afectacion_igv_id) REFERENCES tipo_afectacion_igv (id),
  CONSTRAINT ck_cdet_origen   CHECK (producto_id IS NOT NULL OR estancia_id IS NOT NULL),
  CONSTRAINT ck_cdet_valores  CHECK (cantidad > 0 AND valor_unitario >= 0 AND total >= 0)
) ENGINE=InnoDB COMMENT='Líneas del comprobante';

-- FK diferida: kardex -> detalle de venta (se crea aquí por orden de dependencias)
ALTER TABLE movimiento_inventario
  ADD CONSTRAINT fk_mi_vd FOREIGN KEY (comprobante_detalle_id) REFERENCES comprobante_detalle (id);

CREATE TABLE comprobante_pago (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  comprobante_id  BIGINT UNSIGNED NOT NULL,
  metodo_pago_id  TINYINT UNSIGNED NOT NULL,
  monto           DECIMAL(14,2) NOT NULL,
  referencia      VARCHAR(60)  NULL COMMENT 'Nº operación / voucher',
  fecha_hora      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cpago_comp (comprobante_id),
  KEY ix_cpago_metodo (metodo_pago_id),
  CONSTRAINT fk_cpago_comp   FOREIGN KEY (comprobante_id) REFERENCES comprobante (id),
  CONSTRAINT fk_cpago_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodo_pago (id),
  CONSTRAINT ck_cpago_monto  CHECK (monto > 0)
) ENGINE=InnoDB COMMENT='Pagos (mixtos) de un comprobante';

CREATE TABLE comprobante_cuota (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  comprobante_id     BIGINT UNSIGNED NOT NULL,
  numero_cuota       TINYINT UNSIGNED NOT NULL,
  monto              DECIMAL(14,2) NOT NULL,
  fecha_vencimiento  DATE          NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ccuota (comprobante_id, numero_cuota),
  CONSTRAINT fk_ccuota_comp FOREIGN KEY (comprobante_id) REFERENCES comprobante (id),
  CONSTRAINT ck_ccuota_monto CHECK (monto > 0)
) ENGINE=InnoDB COMMENT='Cuotas de facturas al crédito (obligatorio en XML)';

CREATE TABLE sunat_envio (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  comprobante_id   BIGINT UNSIGNED NULL,
  lote_sunat_id    BIGINT UNSIGNED NULL,
  operacion        ENUM('sendBill','sendSummary','getStatus','getStatusCdr') NOT NULL,
  ticket           VARCHAR(50)  NULL,
  codigo_respuesta VARCHAR(10)  NULL,
  mensaje          VARCHAR(1000) NULL,
  exitoso          TINYINT(1)   NOT NULL DEFAULT 0,
  duracion_ms      INT UNSIGNED NULL,
  fecha_hora       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_se_comp (comprobante_id, fecha_hora),
  KEY ix_se_lote (lote_sunat_id),
  CONSTRAINT fk_se_comp FOREIGN KEY (comprobante_id) REFERENCES comprobante (id),
  CONSTRAINT ck_se_origen CHECK (comprobante_id IS NOT NULL OR lote_sunat_id IS NOT NULL)
) ENGINE=InnoDB COMMENT='Log de cada intento de envío/consulta a SUNAT/OSE';

CREATE TABLE lote_sunat (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id         INT UNSIGNED NOT NULL,
  tipo               ENUM('RC','RA') NOT NULL COMMENT 'RC = resumen diario boletas; RA = comunicación de baja',
  fecha_referencia   DATE         NOT NULL COMMENT 'Fecha de emisión de los documentos',
  fecha_generacion   DATE         NOT NULL,
  correlativo        SMALLINT UNSIGNED NOT NULL COMMENT 'Correlativo del día (RC-YYYYMMDD-n)',
  identificador      VARCHAR(30)  AS (CONCAT(tipo, '-', DATE_FORMAT(fecha_generacion, '%Y%m%d'), '-', correlativo)) STORED,
  ticket             VARCHAR(50)  NULL,
  estado             ENUM('PENDIENTE','ENVIADO','ACEPTADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  xml_ruta           VARCHAR(255) NULL,
  cdr_ruta           VARCHAR(255) NULL,
  cdr_codigo         VARCHAR(10)  NULL,
  cdr_descripcion    VARCHAR(500) NULL,
  usuario_id         INT UNSIGNED NOT NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lote (empresa_id, tipo, fecha_generacion, correlativo),
  KEY ix_lote_estado (estado),
  CONSTRAINT fk_lote_empresa FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT fk_lote_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
) ENGINE=InnoDB COMMENT='Resumen diario (RC) y Comunicación de baja (RA)';

ALTER TABLE sunat_envio
  ADD CONSTRAINT fk_se_lote FOREIGN KEY (lote_sunat_id) REFERENCES lote_sunat (id);

CREATE TABLE lote_sunat_detalle (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lote_sunat_id    BIGINT UNSIGNED NOT NULL,
  comprobante_id   BIGINT UNSIGNED NOT NULL,
  condicion        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'RC: 1=adicionar 2=modificar 3=anular',
  motivo_baja      VARCHAR(100) NULL COMMENT 'Obligatorio para RA',
  PRIMARY KEY (id),
  UNIQUE KEY uk_lsd (lote_sunat_id, comprobante_id),
  KEY ix_lsd_comp (comprobante_id),
  CONSTRAINT fk_lsd_lote FOREIGN KEY (lote_sunat_id)  REFERENCES lote_sunat (id) ON DELETE CASCADE,
  CONSTRAINT fk_lsd_comp FOREIGN KEY (comprobante_id) REFERENCES comprobante (id),
  CONSTRAINT ck_lsd_condicion CHECK (condicion IN (1,2,3))
) ENGINE=InnoDB COMMENT='Comprobantes incluidos en un RC/RA';

CREATE TABLE caja_movimiento (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  caja_sesion_id   BIGINT UNSIGNED NOT NULL,
  concepto_movimiento_id SMALLINT UNSIGNED NOT NULL COMMENT 'Define si es INGRESO o EGRESO de caja',
  metodo_pago_id   TINYINT UNSIGNED NOT NULL,
  monto            DECIMAL(14,2) NOT NULL,
  comprobante_pago_id BIGINT UNSIGNED NULL,
  reserva_id       BIGINT UNSIGNED NULL,
  descripcion      VARCHAR(250) NULL,
  usuario_id       INT UNSIGNED NOT NULL,
  fecha_hora       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cm_sesion (caja_sesion_id, fecha_hora),
  KEY ix_cm_metodo (metodo_pago_id),
  KEY ix_cm_cpago (comprobante_pago_id),
  KEY ix_cm_reserva (reserva_id),
  KEY ix_cm_concepto (concepto_movimiento_id),
  CONSTRAINT fk_cm_concepto FOREIGN KEY (concepto_movimiento_id) REFERENCES concepto_movimiento (id),
  CONSTRAINT fk_cm_sesion  FOREIGN KEY (caja_sesion_id)      REFERENCES caja_sesion (id),
  CONSTRAINT fk_cm_metodo  FOREIGN KEY (metodo_pago_id)      REFERENCES metodo_pago (id),
  CONSTRAINT fk_cm_cpago   FOREIGN KEY (comprobante_pago_id) REFERENCES comprobante_pago (id),
  CONSTRAINT fk_cm_reserva FOREIGN KEY (reserva_id)          REFERENCES reserva (id),
  CONSTRAINT fk_cm_usuario FOREIGN KEY (usuario_id)          REFERENCES usuario (id),
  CONSTRAINT ck_cm_monto   CHECK (monto > 0)
) ENGINE=InnoDB COMMENT='Ingresos y egresos de caja';

/* =====================================================================
   8. TRIGGERS (integridad que no se expresa con constraints)
   ===================================================================== */

-- 8.1 Evitar doble reserva de la misma habitación en rangos que se cruzan
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
         AND rh.fecha_entrada < NEW.fecha_salida
         AND rh.fecha_salida  > NEW.fecha_entrada) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La habitación ya está reservada en ese rango de fechas';
  END IF;
END;

-- 8.2 Evitar check-in en una habitación con estancia activa que se cruza
CREATE TRIGGER trg_est_bi_solape BEFORE INSERT ON estancia
FOR EACH ROW
BEGIN
  IF EXISTS (
      SELECT 1 FROM estancia e
       WHERE e.habitacion_id = NEW.habitacion_id
         AND e.estado = 'ACTIVA'
         AND e.checkin_at < NEW.checkout_previsto
         AND COALESCE(e.checkout_at, e.checkout_previsto) > NEW.checkin_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La habitación está ocupada en ese horario';
  END IF;
END;

-- 8.3 Historial automático de estados de habitación
CREATE TRIGGER trg_hab_au_estado AFTER UPDATE ON habitacion
FOR EACH ROW
BEGIN
  IF NOT (OLD.estado_habitacion_id <=> NEW.estado_habitacion_id) THEN
    INSERT INTO habitacion_estado_historial
           (habitacion_id, estado_anterior_id, estado_nuevo_id, usuario_id, motivo)
    VALUES (NEW.id, OLD.estado_habitacion_id, NEW.estado_habitacion_id, @app_usuario_id, @app_motivo);
  END IF;
END;

-- 8.4 Los conceptos deben ser del ámbito correcto (CAJA o INVENTARIO)
CREATE TRIGGER trg_mi_bi_concepto BEFORE INSERT ON movimiento_inventario
FOR EACH ROW
BEGIN
  IF (SELECT ambito FROM concepto_movimiento WHERE id = NEW.concepto_movimiento_id) <> 'INVENTARIO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El concepto no es de inventario';
  END IF;
END;

CREATE TRIGGER trg_cm_bi_concepto BEFORE INSERT ON caja_movimiento
FOR EACH ROW
BEGIN
  IF (SELECT ambito FROM concepto_movimiento WHERE id = NEW.concepto_movimiento_id) <> 'CAJA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El concepto no es de caja';
  END IF;
END;

-- 8.5 Kardex -> saldo de stock: INGRESO suma, EGRESO resta (stock negativo prohibido)
CREATE TRIGGER trg_mi_ai_stock AFTER INSERT ON movimiento_inventario
FOR EACH ROW
BEGIN
  DECLARE v_delta DECIMAL(12,3);
  SELECT tm.signo * NEW.cantidad INTO v_delta
    FROM concepto_movimiento cm
    JOIN tipo_movimiento tm ON tm.id = cm.tipo_movimiento_id
   WHERE cm.id = NEW.concepto_movimiento_id;

  INSERT INTO producto_stock (sucursal_id, producto_id, stock)
  VALUES (NEW.sucursal_id, NEW.producto_id, v_delta)
  ON DUPLICATE KEY UPDATE stock = stock + v_delta;

  IF (SELECT stock FROM producto_stock
       WHERE sucursal_id = NEW.sucursal_id AND producto_id = NEW.producto_id) < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stock insuficiente';
  END IF;
END;

-- 8.6 Inmutabilidad: un comprobante aceptado (o un INTERNO anulado) no cambia importes ni receptor
CREATE TRIGGER trg_comp_bu_inmutable BEFORE UPDATE ON comprobante
FOR EACH ROW
BEGIN
  IF OLD.estado_sunat IN ('ACEPTADO','OBSERVADO','ANULADO','NO_APLICA') AND (
       NOT (OLD.total <=> NEW.total)
    OR NOT (OLD.cliente_num_doc <=> NEW.cliente_num_doc)
    OR NOT (OLD.numero <=> NEW.numero)
    OR NOT (OLD.serie_id <=> NEW.serie_id)
    OR NOT (OLD.fecha_emision <=> NEW.fecha_emision)) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Comprobante emitido: no se modifica. Anúlelo (INTERNO) o use NC/ND o baja (FACTURA/BOLETA)';
  END IF;
END;

CREATE TRIGGER trg_comp_bd_prohibido BEFORE DELETE ON comprobante
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los comprobantes no se eliminan; se anulan';
END;

-- 8.7 Reglas por tipo de comprobante (FACTURA, BOLETA, INTERNO, NC, ND)
CREATE TRIGGER trg_comp_bi_tipo BEFORE INSERT ON comprobante
FOR EACH ROW
BEGIN
  DECLARE v_cod VARCHAR(20);
  DECLARE v_envia TINYINT;
  SELECT codigo, envia_sunat INTO v_cod, v_envia FROM tipo_comprobante WHERE id = NEW.tipo_comprobante_id;

  IF (SELECT tipo_comprobante_id FROM serie WHERE id = NEW.serie_id) <> NEW.tipo_comprobante_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La serie no corresponde al tipo de comprobante';
  END IF;
  -- INTERNO: no se firma ni se envía a SUNAT
  IF v_envia = 0 THEN
    SET NEW.estado_sunat = 'NO_APLICA';
  ELSEIF NEW.estado_sunat = 'NO_APLICA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo un comprobante INTERNO puede tener estado NO_APLICA';
  END IF;
  IF v_cod = 'FACTURA' AND NEW.cliente_tipo_doc <> '6' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La factura requiere cliente con RUC';
  END IF;
  IF v_cod IN ('NOTA_CREDITO','NOTA_DEBITO') THEN
    IF NEW.comprobante_ref_id IS NULL OR NEW.motivo_nota_id IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NC/ND requiere comprobante de referencia y motivo';
    END IF;
    IF (SELECT tc.codigo FROM comprobante c JOIN tipo_comprobante tc ON tc.id = c.tipo_comprobante_id
         WHERE c.id = NEW.comprobante_ref_id) NOT IN ('FACTURA','BOLETA') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NC/ND solo modifican una FACTURA o BOLETA; un INTERNO se anula directamente';
    END IF;
  END IF;
END;

/* =====================================================================
   9. PROCEDIMIENTOS ALMACENADOS
   ===================================================================== */

-- 9.1 Correlativo seguro en concurrencia (bloqueo de fila)
--     Llamar DENTRO de la misma transacción que inserta el comprobante.
CREATE PROCEDURE sp_siguiente_correlativo(IN p_serie_id INT UNSIGNED, OUT p_numero INT UNSIGNED)
BEGIN
  DECLARE v_activo TINYINT;
  SELECT correlativo_actual + 1, activo INTO p_numero, v_activo
    FROM serie WHERE id = p_serie_id FOR UPDATE;
  IF p_numero IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Serie inexistente';
  END IF;
  IF v_activo = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Serie inactiva';
  END IF;
  UPDATE serie SET correlativo_actual = p_numero WHERE id = p_serie_id;
END;

-- 9.2 Tarifa vigente para una fecha (precio dinámico por canal y turno)
CREATE FUNCTION fn_tarifa_vigente(
  p_sucursal_id INT UNSIGNED, p_tipo_hab_id INT UNSIGNED,
  p_canal_id SMALLINT UNSIGNED, p_turno_id TINYINT UNSIGNED, p_fecha DATE)
RETURNS DECIMAL(14,2)
READS SQL DATA
BEGIN
  DECLARE v_precio DECIMAL(14,2);
  SELECT precio INTO v_precio
    FROM tarifa
   WHERE sucursal_id = p_sucursal_id AND tipo_habitacion_id = p_tipo_hab_id
     AND canal_venta_id = p_canal_id AND turno_id = p_turno_id AND activo = 1
     AND vigente_desde <= p_fecha AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha)
   ORDER BY vigente_desde DESC
   LIMIT 1;
  RETURN v_precio;
END;

-- 9.3 Cierre de caja: calcula efectivo esperado y cierra la sesión
CREATE PROCEDURE sp_cerrar_caja(IN p_sesion_id BIGINT UNSIGNED, IN p_monto_declarado DECIMAL(14,2))
BEGIN
  DECLARE v_esperado DECIMAL(14,2);
  -- Efectivo esperado = apertura + INGRESOS - EGRESOS en efectivo (el signo viene de tipo_movimiento)
  SELECT cs.monto_apertura
         + COALESCE(SUM(CASE WHEN mp.es_efectivo = 1 THEN tm.signo * cm.monto END), 0)
    INTO v_esperado
    FROM caja_sesion cs
    LEFT JOIN caja_movimiento cm      ON cm.caja_sesion_id = cs.id
    LEFT JOIN concepto_movimiento cmo ON cmo.id = cm.concepto_movimiento_id
    LEFT JOIN tipo_movimiento tm      ON tm.id = cmo.tipo_movimiento_id
    LEFT JOIN metodo_pago mp          ON mp.id = cm.metodo_pago_id
   WHERE cs.id = p_sesion_id AND cs.estado = 'ABIERTA'
   GROUP BY cs.id, cs.monto_apertura;

  IF v_esperado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sesión inexistente o ya cerrada';
  END IF;

  UPDATE caja_sesion
     SET fecha_cierre = NOW(), monto_cierre_sistema = v_esperado,
         monto_cierre_declarado = p_monto_declarado, estado = 'CERRADA'
   WHERE id = p_sesion_id;
END;


/* =====================================================================
   10. VISTAS DE REPORTES
   ===================================================================== */

-- R1. Estado de habitación (rack)
CREATE OR REPLACE VIEW vw_estado_habitacion AS
SELECT s.id AS sucursal_id, s.nombre AS sucursal, p.numero AS piso, h.id AS habitacion_id,
       h.numero AS habitacion, th.nombre AS tipo_habitacion,
       eh.codigo AS estado, eh.color_hex,
       e.id AS estancia_id, e.checkin_at, e.checkout_previsto,
       c.nombre_completo AS huesped_titular
  FROM habitacion h
  JOIN sucursal s           ON s.id = h.sucursal_id
  JOIN piso p               ON p.id = h.piso_id
  JOIN tipo_habitacion th   ON th.id = h.tipo_habitacion_id
  JOIN estado_habitacion eh ON eh.id = h.estado_habitacion_id
  LEFT JOIN estancia e      ON e.habitacion_id = h.id AND e.estado = 'ACTIVA'
  LEFT JOIN estancia_huesped ehu ON ehu.estancia_id = e.id AND ehu.es_titular = 1
  LEFT JOIN cliente c       ON c.id = ehu.cliente_id
 WHERE h.activo = 1;

-- R2. Hotel/hostal - reservado
CREATE OR REPLACE VIEW vw_reservas AS
SELECT r.sucursal_id, r.id AS reserva_id, r.codigo, r.estado, cv.nombre AS canal, r.codigo_externo,
       c.nombre_completo AS titular, c.numero_documento,
       h.numero AS habitacion, th.nombre AS tipo_habitacion, t.nombre AS turno,
       rh.fecha_entrada, rh.fecha_salida, rh.cantidad_turnos, rh.precio_unitario, rh.subtotal,
       r.monto_adelanto, r.created_at
  FROM reserva r
  JOIN reserva_habitacion rh ON rh.reserva_id = r.id AND rh.estado = 'ACTIVA'
  JOIN cliente c             ON c.id = r.cliente_id
  JOIN canal_venta cv        ON cv.id = r.canal_venta_id
  JOIN habitacion h          ON h.id = rh.habitacion_id
  JOIN tipo_habitacion th    ON th.id = h.tipo_habitacion_id
  JOIN turno t               ON t.id = rh.turno_id;

-- R3. Libro de registro de entrada y salida de huéspedes
CREATE OR REPLACE VIEW vw_libro_huespedes AS
SELECT e.sucursal_id, e.id AS estancia_id, e.checkin_at AS fecha_entrada, e.checkout_at AS fecha_salida,
       h.numero AS habitacion, c.nombre_completo AS huesped, tdi.abreviatura AS tipo_doc,
       c.numero_documento, pa.nombre AS nacionalidad, c.fecha_nacimiento, c.sexo,
       e.procedencia, e.destino, e.motivo_viaje, ehu.es_titular
  FROM estancia e
  JOIN estancia_huesped ehu         ON ehu.estancia_id = e.id
  JOIN cliente c                    ON c.id = ehu.cliente_id
  JOIN tipo_documento_identidad tdi ON tdi.id = c.tipo_documento_id
  JOIN pais pa                      ON pa.codigo = c.pais_codigo
  JOIN habitacion h                 ON h.id = e.habitacion_id
 WHERE e.estado <> 'ANULADA';

-- R4. Compras / Compras detallada
CREATE OR REPLACE VIEW vw_compras AS
SELECT co.sucursal_id, co.id AS compra_id, co.fecha_emision, tc.descripcion AS tipo_documento,
       CONCAT(co.serie, '-', co.numero) AS documento, pr.numero_documento AS ruc_proveedor,
       pr.razon_social AS proveedor, m.codigo_iso AS moneda, co.subtotal, co.igv, co.total, co.estado
  FROM compra co
  JOIN proveedor pr        ON pr.id = co.proveedor_id
  JOIN tipo_comprobante tc ON tc.id = co.tipo_comprobante_id
  JOIN moneda m            ON m.id = co.moneda_id;

CREATE OR REPLACE VIEW vw_compras_detalle AS
SELECT v.*, p.codigo AS producto_codigo, p.nombre AS producto, cd.cantidad, cd.costo_unitario,
       cd.subtotal AS item_subtotal, cd.igv AS item_igv
  FROM vw_compras v
  JOIN compra_detalle cd ON cd.compra_id = v.compra_id
  JOIN producto p        ON p.id = cd.producto_id;

-- R5. Venta / Venta detallada
--     Las NC restan (signo -1). Los anulados se excluyen del neto.
--     es_tributario = 0 para INTERNO (no va a SUNAT ni al registro de ventas).
CREATE OR REPLACE VIEW vw_ventas AS
SELECT cp.sucursal_id, cp.id AS comprobante_id, cp.fecha_emision, cp.hora_emision,
       tc.codigo AS tipo_codigo, tc.descripcion AS tipo_comprobante, tc.envia_sunat AS es_tributario,
       CONCAT(cp.serie, '-', LPAD(cp.numero, 8, '0')) AS documento,
       cp.cliente_num_doc, cp.cliente_nombre, m.codigo_iso AS moneda,
       IF(tc.codigo = 'NOTA_CREDITO', -1, 1) AS signo,
       cp.total_gravada, cp.total_exonerada, cp.total_inafecta, cp.descuento_global,
       cp.total_igv, cp.total, cp.estado_sunat, cp.caja_sesion_id,
       u.username AS usuario, cv.nombre AS canal
  FROM comprobante cp
  JOIN tipo_comprobante tc ON tc.id = cp.tipo_comprobante_id
  JOIN moneda m            ON m.id = cp.moneda_id
  JOIN usuario u           ON u.id = cp.usuario_id
  LEFT JOIN estancia e     ON e.id = cp.estancia_id
  LEFT JOIN canal_venta cv ON cv.id = e.canal_venta_id;

CREATE OR REPLACE VIEW vw_ventas_detalle AS
SELECT v.sucursal_id, v.comprobante_id, v.fecha_emision, v.documento, v.cliente_nombre, v.estado_sunat, v.signo,
       d.item, d.descripcion, COALESCE(cat.nombre, 'HOSPEDAJE') AS categoria,
       d.cantidad, d.precio_unitario, d.descuento, d.valor_venta, d.igv, d.total
  FROM vw_ventas v
  JOIN comprobante_detalle d    ON d.comprobante_id = v.comprobante_id
  LEFT JOIN producto p          ON p.id = d.producto_id
  LEFT JOIN categoria_producto cat ON cat.id = p.categoria_id;

-- R6. Venta estadística / gráfico (agregado diario; el front agrupa por semana/mes)
CREATE OR REPLACE VIEW vw_ventas_diarias AS
SELECT sucursal_id, fecha_emision,
       COUNT(*)                                   AS documentos,
       SUM(signo * total)                         AS total_neto,
       SUM(signo * total_igv)                     AS igv_neto,
       SUM(IF(tipo_codigo = 'FACTURA', total, 0))      AS total_facturas,
       SUM(IF(tipo_codigo = 'BOLETA', total, 0))       AS total_boletas,
       SUM(IF(tipo_codigo = 'INTERNO', total, 0))      AS total_internos,
       SUM(IF(tipo_codigo = 'NOTA_CREDITO', total, 0)) AS total_notas_credito
  FROM vw_ventas
 WHERE estado_sunat NOT IN ('ANULADO','RECHAZADO')
 GROUP BY sucursal_id, fecha_emision;

CREATE OR REPLACE VIEW vw_ocupacion_diaria AS
SELECT h.sucursal_id, DATE(e.checkin_at) AS fecha, COUNT(DISTINCT e.id) AS checkins,
       SUM(e.monto_hospedaje) AS ingreso_hospedaje, cv.nombre AS canal, t.nombre AS turno
  FROM estancia e
  JOIN habitacion h   ON h.id = e.habitacion_id
  JOIN canal_venta cv ON cv.id = e.canal_venta_id
  JOIN turno t        ON t.id = e.turno_id
 WHERE e.estado <> 'ANULADA'
 GROUP BY h.sucursal_id, DATE(e.checkin_at), cv.nombre, t.nombre;

-- R7. Liquidación de cajero
CREATE OR REPLACE VIEW vw_liquidacion_cajero AS
SELECT cs.id AS caja_sesion_id, ca.sucursal_id, ca.nombre AS caja, u.username AS cajero,
       cs.fecha_apertura, cs.fecha_cierre, cs.estado, mp.descripcion AS metodo_pago,
       SUM(IF(tm.codigo = 'INGRESO', cm.monto, 0)) AS ingresos,
       SUM(IF(tm.codigo = 'EGRESO',  cm.monto, 0)) AS egresos,
       SUM(tm.signo * cm.monto)                   AS neto,
       cs.monto_apertura, cs.monto_cierre_sistema, cs.monto_cierre_declarado, cs.diferencia
  FROM caja_sesion cs
  JOIN caja ca                   ON ca.id = cs.caja_id
  JOIN usuario u                 ON u.id = cs.usuario_id
  JOIN caja_movimiento cm        ON cm.caja_sesion_id = cs.id
  JOIN concepto_movimiento cmo   ON cmo.id = cm.concepto_movimiento_id
  JOIN tipo_movimiento tm        ON tm.id = cmo.tipo_movimiento_id
  JOIN metodo_pago mp            ON mp.id = cm.metodo_pago_id
 GROUP BY cs.id, ca.sucursal_id, ca.nombre, u.username, cs.fecha_apertura, cs.fecha_cierre, cs.estado,
          mp.descripcion, cs.monto_apertura, cs.monto_cierre_sistema, cs.monto_cierre_declarado, cs.diferencia;

-- R8. Movimientos de caja detallados (INGRESO / EGRESO por concepto)
CREATE OR REPLACE VIEW vw_caja_movimientos AS
SELECT cm.caja_sesion_id, cm.id AS movimiento_id, cm.fecha_hora, tm.codigo AS tipo_movimiento,
       cmo.codigo AS concepto, mp.descripcion AS metodo_pago, cm.monto, tm.signo * cm.monto AS monto_con_signo,
       cm.descripcion, u.username AS usuario
  FROM caja_movimiento cm
  JOIN concepto_movimiento cmo ON cmo.id = cm.concepto_movimiento_id
  JOIN tipo_movimiento tm      ON tm.id = cmo.tipo_movimiento_id
  JOIN metodo_pago mp          ON mp.id = cm.metodo_pago_id
  JOIN usuario u               ON u.id = cm.usuario_id;

-- R9. Kardex con saldo acumulado por sucursal y producto
CREATE OR REPLACE VIEW vw_kardex AS
SELECT mi.sucursal_id, mi.producto_id, p.codigo AS producto_codigo, p.nombre AS producto,
       mi.id AS movimiento_id, mi.fecha_hora, tm.codigo AS tipo_movimiento, cmo.codigo AS concepto,
       IF(tm.signo = 1, mi.cantidad, 0) AS ingreso, IF(tm.signo = -1, mi.cantidad, 0) AS egreso,
       SUM(tm.signo * mi.cantidad) OVER (PARTITION BY mi.sucursal_id, mi.producto_id
                                         ORDER BY mi.fecha_hora, mi.id) AS saldo,
       mi.costo_unitario
  FROM movimiento_inventario mi
  JOIN concepto_movimiento cmo ON cmo.id = mi.concepto_movimiento_id
  JOIN tipo_movimiento tm      ON tm.id = cmo.tipo_movimiento_id
  JOIN producto p              ON p.id = mi.producto_id;

/* =====================================================================
   11. DATOS SEMILLA (catálogos)
   ===================================================================== */

INSERT INTO tipo_documento_identidad (codigo_sunat, abreviatura, descripcion, longitud) VALUES
 ('0','SIN DOC','Doc. trib. no domiciliado sin RUC',NULL),
 ('1','DNI','Documento Nacional de Identidad',8),
 ('4','CE','Carnet de extranjería',NULL),
 ('6','RUC','Registro Único de Contribuyentes',11),
 ('7','PAS','Pasaporte',NULL),
 ('A','CDI','Cédula diplomática de identidad',NULL);

-- Los tres tipos de venta: FACTURA, BOLETA, INTERNO.
-- NC y ND se mantienen porque SUNAT las exige para corregir o anular facturas y boletas aceptadas.
INSERT INTO tipo_comprobante (codigo, codigo_sunat, descripcion, prefijo_serie, envia_sunat, uso_venta) VALUES
 ('FACTURA',       '01', 'Factura electrónica',            'F', 1, 1),
 ('BOLETA',        '03', 'Boleta de venta electrónica',    'B', 1, 1),
 ('INTERNO',       NULL, 'Comprobante interno (no tributario)', 'I', 0, 1),
 ('NOTA_CREDITO',  '07', 'Nota de crédito electrónica',    NULL, 1, 0),
 ('NOTA_DEBITO',   '08', 'Nota de débito electrónica',     NULL, 1, 0),
 ('GUIA_REMISION', '09', 'Guía de remisión (compras)',     'T', 1, 0);

INSERT INTO tipo_movimiento (codigo, descripcion, signo) VALUES
 ('INGRESO','Ingreso: suma al saldo de caja o al stock', 1),
 ('EGRESO', 'Egreso: resta del saldo de caja o del stock', -1);

INSERT INTO concepto_movimiento (tipo_movimiento_id, ambito, codigo, descripcion)
SELECT tm.id, x.ambito, x.codigo, x.descr FROM tipo_movimiento tm
JOIN (SELECT 'INGRESO' t, 'CAJA' ambito, 'VENTA' codigo, 'Cobro de una venta' descr UNION ALL
      SELECT 'INGRESO','CAJA','ADELANTO_RESERVA','Adelanto de una reserva' UNION ALL
      SELECT 'INGRESO','CAJA','INGRESO_FONDOS','Ingreso de fondos a caja' UNION ALL
      SELECT 'INGRESO','CAJA','OTRO_INGRESO','Otro ingreso' UNION ALL
      SELECT 'EGRESO','CAJA','DEVOLUCION','Devolución a un cliente' UNION ALL
      SELECT 'EGRESO','CAJA','GASTO','Gasto menor pagado desde caja' UNION ALL
      SELECT 'EGRESO','CAJA','PAGO_PROVEEDOR','Pago a proveedor en efectivo' UNION ALL
      SELECT 'EGRESO','CAJA','RETIRO','Retiro de efectivo / depósito al banco' UNION ALL
      SELECT 'EGRESO','CAJA','OTRO_EGRESO','Otro egreso' UNION ALL
      SELECT 'INGRESO','INVENTARIO','COMPRA','Ingreso por compra' UNION ALL
      SELECT 'INGRESO','INVENTARIO','AJUSTE_POSITIVO','Ajuste por inventario físico (sobrante)' UNION ALL
      SELECT 'INGRESO','INVENTARIO','DEVOLUCION_CLIENTE','Devolución de un cliente' UNION ALL
      SELECT 'INGRESO','INVENTARIO','ANULACION_VENTA','Reingreso por venta anulada' UNION ALL
      SELECT 'EGRESO','INVENTARIO','VENTA','Salida por venta' UNION ALL
      SELECT 'EGRESO','INVENTARIO','CONSUMO_INTERNO','Consumo del hotel (amenities, limpieza)' UNION ALL
      SELECT 'EGRESO','INVENTARIO','MERMA','Merma o producto vencido' UNION ALL
      SELECT 'EGRESO','INVENTARIO','AJUSTE_NEGATIVO','Ajuste por inventario físico (faltante)' UNION ALL
      SELECT 'EGRESO','INVENTARIO','DEVOLUCION_PROVEEDOR','Devolución a un proveedor') x
  ON x.t = tm.codigo;

INSERT INTO motivo_nota (tipo_comprobante_id, codigo_sunat, descripcion)
SELECT id, x.cod, x.descr FROM tipo_comprobante
JOIN (SELECT '01' cod, 'Anulación de la operación' descr UNION ALL
      SELECT '02','Anulación por error en el RUC' UNION ALL
      SELECT '03','Corrección por error en la descripción' UNION ALL
      SELECT '04','Descuento global' UNION ALL
      SELECT '05','Descuento por ítem' UNION ALL
      SELECT '06','Devolución total' UNION ALL
      SELECT '07','Devolución por ítem' UNION ALL
      SELECT '09','Disminución en el valor' UNION ALL
      SELECT '13','Ajustes - montos y/o fechas de pago') x
WHERE codigo_sunat = '07';

INSERT INTO motivo_nota (tipo_comprobante_id, codigo_sunat, descripcion)
SELECT id, x.cod, x.descr FROM tipo_comprobante
JOIN (SELECT '01' cod, 'Intereses por mora' descr UNION ALL
      SELECT '02','Aumento en el valor' UNION ALL
      SELECT '03','Penalidades / otros conceptos') x
WHERE codigo_sunat = '08';

INSERT INTO tipo_afectacion_igv (codigo_sunat, descripcion, grupo) VALUES
 ('10','Gravado - Operación onerosa','GRAVADO'),
 ('20','Exonerado - Operación onerosa','EXONERADO'),
 ('30','Inafecto - Operación onerosa','INAFECTO'),
 ('40','Exportación de bienes o servicios','EXPORTACION'),
 ('21','Exonerado - Transferencia gratuita','GRATUITO'),
 ('31','Inafecto - Retiro por bonificación','GRATUITO');

INSERT INTO unidad_medida (codigo_sunat, descripcion) VALUES
 ('NIU','Unidad (bienes)'), ('ZZ','Unidad (servicios)'), ('KGM','Kilogramo'),
 ('LTR','Litro'), ('BX','Caja'), ('DAY','Día'), ('HUR','Hora');

INSERT INTO moneda (codigo_iso, descripcion, simbolo) VALUES
 ('PEN','Sol','S/'), ('USD','Dólar americano','US$');

INSERT INTO metodo_pago (codigo, descripcion, es_efectivo) VALUES
 ('EFECTIVO','Efectivo',1), ('TARJETA','Tarjeta débito/crédito',0), ('YAPE','Yape',0),
 ('PLIN','Plin',0), ('TRANSFERENCIA','Transferencia bancaria',0), ('OTA','Cobrado por la OTA',0);

INSERT INTO estado_habitacion (codigo, descripcion, color_hex, permite_venta, orden) VALUES
 ('DESOCUPADA','Desocupada','#4CAF50',1,1),
 ('RESERVADA','Reservada','#2196F3',0,2),
 ('CONFIRMADA','Confirmada','#3F51B5',0,3),
 ('OCUPADA','Ocupada','#F44336',0,4),
 ('LIMPIEZA','Limpieza','#FFC107',0,5),
 ('MANTENIMIENTO','Mantenimiento','#795548',0,6);

INSERT INTO turno (nombre, duracion_horas) VALUES
 ('Turno 24 horas',24), ('Turno 12 horas',12), ('Turno 6 horas',6), ('Turno 3 horas',3);

INSERT INTO rol (nombre, descripcion) VALUES
 ('ADMINISTRADOR','Acceso total'), ('RECEPCIONISTA','Reservas, check-in/out, ventas, caja'),
 ('CAJERO','Ventas y caja'), ('ALMACEN','Compras e inventario'), ('CONTADOR','Reportes y facturación');

INSERT INTO permiso (codigo, modulo, descripcion) VALUES
 ('reserva.crear','RESERVAS','Crear reservas'), ('reserva.cancelar','RESERVAS','Cancelar reservas'),
 ('estancia.checkin','RESERVAS','Registrar check-in'), ('estancia.checkout','RESERVAS','Registrar check-out'),
 ('tarifa.editar','RESERVAS','Modificar precios'), ('comprobante.emitir','VENTAS','Emitir comprobantes'),
 ('comprobante.anular','VENTAS','Anular / emitir NC'), ('descuento.aplicar','VENTAS','Aplicar descuentos'),
 ('compra.registrar','COMPRAS','Registrar compras'), ('caja.abrir','CAJA','Abrir caja'),
 ('caja.cerrar','CAJA','Cerrar caja'), ('reporte.ver','REPORTES','Ver reportes'),
 ('config.empresa','CONFIG','Configurar empresa, series y certificado');

INSERT INTO rol_permiso (rol_id, permiso_id) SELECT r.id, p.id FROM rol r CROSS JOIN permiso p WHERE r.nombre = 'ADMINISTRADOR';

INSERT INTO pais (codigo, nombre) VALUES
 ('PE','Perú'), ('CL','Chile'), ('BO','Bolivia'), ('AR','Argentina'), ('BR','Brasil'),
 ('CO','Colombia'), ('EC','Ecuador'), ('US','Estados Unidos'), ('ES','España'), ('FR','Francia');

INSERT INTO ubigeo (codigo, departamento, provincia, distrito) VALUES
 ('230101','TACNA','TACNA','TACNA'), ('150101','LIMA','LIMA','LIMA');

/* =====================================================================
   12. USUARIOS DE BASE DE DATOS (mínimo privilegio) — ejecutar como root
   ===================================================================== */
-- CREATE USER 'hotel_app'@'10.0.0.%'  IDENTIFIED BY '<<clave_segura>>';
-- GRANT SELECT, INSERT, UPDATE ON hotel_db.* TO 'hotel_app'@'10.0.0.%';
-- GRANT EXECUTE ON hotel_db.* TO 'hotel_app'@'10.0.0.%';
-- CREATE USER 'hotel_report'@'10.0.0.%' IDENTIFIED BY '<<clave_segura>>';
-- GRANT SELECT ON hotel_db.* TO 'hotel_report'@'10.0.0.%';
-- CREATE USER 'hotel_backup'@'localhost' IDENTIFIED BY '<<clave_segura>>';
-- GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES, PROCESS ON *.* TO 'hotel_backup'@'localhost';
