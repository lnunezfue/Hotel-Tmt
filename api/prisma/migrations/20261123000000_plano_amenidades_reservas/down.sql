-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations
DELETE rp FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE p.codigo = 'reserva.ver';
DELETE FROM permiso WHERE codigo = 'reserva.ver';
DROP TABLE habitacion_amenidad;
DROP TABLE amenidad;
DROP TABLE plano_elemento;
ALTER TABLE habitacion DROP CHECK ck_hab_plano, DROP COLUMN plano_alto, DROP COLUMN plano_ancho, DROP COLUMN plano_y, DROP COLUMN plano_x;
ALTER TABLE piso DROP CHECK ck_piso_plano, DROP COLUMN plano_filas, DROP COLUMN plano_columnas;
