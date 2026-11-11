-- Rollback de clientes_fk_sin_cascada (396): vuelve a ON DELETE CASCADE.
-- Borrar un cliente vuelve a borrar sus órdenes, cuenta corriente y recepciones.

SET LOCAL lock_timeout = '3s';

ALTER TABLE ordenes_servicio DROP CONSTRAINT ordenes_servicio_cliente_id_fkey;
ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;

ALTER TABLE cuenta_corriente DROP CONSTRAINT cuenta_corriente_cliente_id_fkey;
ALTER TABLE cuenta_corriente ADD CONSTRAINT cuenta_corriente_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;

ALTER TABLE recepciones DROP CONSTRAINT recepciones_cliente_id_fkey;
ALTER TABLE recepciones ADD CONSTRAINT recepciones_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
