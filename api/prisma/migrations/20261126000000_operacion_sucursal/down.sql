-- Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations.
DELETE rp FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE p.codigo = 'operacion.configurar';
DELETE FROM permiso WHERE codigo = 'operacion.configurar';
DELETE FROM metodo_pago WHERE codigo = 'CULQI' AND NOT EXISTS (SELECT 1 FROM caja_movimiento m WHERE m.metodo_pago_id = metodo_pago.id);
ALTER TABLE estancia_cargo DROP FOREIGN KEY fk_ecargo_comprobante, DROP COLUMN comprobante_id;
DROP TABLE sucursal_franja_salida;
DROP TABLE sucursal_operacion;
