-- S-03 / S-04: gestión de usuarios y configuración del hotel
-- Spec: docs/superpowers/specs/2026-11-09-s03-s04-usuarios-configuracion-design.md

-- Contraseña temporal: tras un restablecimiento el usuario debe cambiarla antes de usar el sistema (RF-SEG-02)
ALTER TABLE usuario
  ADD COLUMN debe_cambiar_clave TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = contraseña temporal asignada por un administrador; debe cambiarla al ingresar'
    AFTER intentos_fallidos;

-- Nuevo motivo: al cambiar la propia contraseña se cierran las demás sesiones del usuario
ALTER TABLE sesion_usuario
  MODIFY COLUMN motivo_revocacion ENUM('LOGOUT','INACTIVIDAD','REUSO','USUARIO_INACTIVO','EXPIRADA','ADMIN','CAMBIO_CLAVE') NULL;

-- Permisos de configuración. Hasta S-02 algunos solo los creaba el seed; aquí quedan en la migración
-- para que existan en cualquier entorno. INSERT IGNORE: no duplica si el seed ya los cargó.
INSERT IGNORE INTO permiso (codigo, modulo, descripcion) VALUES
  ('usuario.ver',               'CONFIG',   'Ver usuarios y roles'),
  ('usuario.gestionar',         'CONFIG',   'Crear y editar usuarios y roles, desbloquear, restablecer contraseñas y cerrar sesiones'),
  ('habitacion.cambiar_estado', 'RESERVAS', 'Cambiar el estado de una habitación'),
  ('habitacion.gestionar',      'RESERVAS', 'Crear y editar habitaciones, pisos y tipos');

-- El administrador recibe los permisos nuevos
INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM rol r
JOIN permiso p ON p.codigo IN ('usuario.ver', 'usuario.gestionar', 'habitacion.cambiar_estado', 'habitacion.gestionar', 'tarifa.editar')
WHERE r.nombre = 'ADMINISTRADOR';
