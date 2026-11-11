-- Borrar un cliente ya no borra su historial en cascada.
--
-- ordenes_servicio, cuenta_corriente y recepciones referenciaban al cliente con
-- ON DELETE CASCADE: un DELETE sobre clientes se llevaba órdenes (y con ellas
-- cobros, garantías y facturas), movimientos de cuenta corriente y recepciones.
-- La API ya lo impide (DELETE /api/clientes/[id] exige admin y responde 409 si
-- hay historial); esto lo impide también en la base, para cualquier otro camino.
--
-- NO ACTION y no RESTRICT a propósito: NO ACTION se chequea al final de la
-- sentencia, así que una cascada que borra en la misma sentencia la orden y el
-- cliente (p. ej. borrar una organización) sigue andando. Un DELETE directo de
-- un cliente con historial falla con foreign_key_violation.
--
-- Sin cambios: sectores_cliente y notification_logs (configuración y logs del
-- propio cliente, siguen en CASCADE) y las que ya son SET NULL. La limpieza de
-- datos de práctica (borrar_datos_practica) solo borra clientes sin referencias.
--
-- Las FKs se recrean NOT VALID y se validan aparte: VALIDATE no bloquea
-- escrituras. Los datos ya cumplían la FK anterior.

SET LOCAL lock_timeout = '3s';

ALTER TABLE ordenes_servicio DROP CONSTRAINT ordenes_servicio_cliente_id_fkey;
ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE NO ACTION NOT VALID;

ALTER TABLE cuenta_corriente DROP CONSTRAINT cuenta_corriente_cliente_id_fkey;
ALTER TABLE cuenta_corriente ADD CONSTRAINT cuenta_corriente_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE NO ACTION NOT VALID;

ALTER TABLE recepciones DROP CONSTRAINT recepciones_cliente_id_fkey;
ALTER TABLE recepciones ADD CONSTRAINT recepciones_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE NO ACTION NOT VALID;

ALTER TABLE ordenes_servicio VALIDATE CONSTRAINT ordenes_servicio_cliente_id_fkey;
ALTER TABLE cuenta_corriente VALIDATE CONSTRAINT cuenta_corriente_cliente_id_fkey;
ALTER TABLE recepciones VALIDATE CONSTRAINT recepciones_cliente_id_fkey;
