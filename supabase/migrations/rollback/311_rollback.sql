-- Rollback de la migracion 311.
--
-- Elimina la funcion revertir_cargos_orden, el indice parcial
-- idx_cuenta_corriente_revertido y las tres columnas de marca de reversa en
-- cuenta_corriente (revertido_at, revertido_por, revertido_movimiento_id).
--
-- PERDIDA DE DATOS: si para el momento de este rollback ya se revirtio algun
-- CARGO con la RPC de la 311, las tres columnas que lo marcan se pierden junto
-- con la columna. El movimiento DEVOLUCION que la reversa generó (via
-- devolver_cuenta_corriente) NO se borra -- sigue siendo una fila mas de
-- cuenta_corriente y el saldo del cliente ya la tiene incorporada -- pero se
-- pierde el vinculo "que CARGO revirtio esta DEVOLUCION" y la marca de que ese
-- CARGO ya fue revertido (una segunda reversa manual del mismo CARGO ya no
-- tendria el guard que se lo impide).
--
-- Antes de correr este rollback, exportar el estado con:
--
--   SELECT id, cliente_id, referencia_id, monto, revertido_at, revertido_por,
--          revertido_movimiento_id
--   FROM cuenta_corriente
--   WHERE revertido_movimiento_id IS NOT NULL;

DROP FUNCTION IF EXISTS revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT);

DROP INDEX IF EXISTS idx_cuenta_corriente_revertido;

ALTER TABLE cuenta_corriente
  DROP COLUMN IF EXISTS revertido_at,
  DROP COLUMN IF EXISTS revertido_por,
  DROP COLUMN IF EXISTS revertido_movimiento_id;
