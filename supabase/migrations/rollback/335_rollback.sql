-- Rollback de la migracion 335.
--
-- Saca la columna `origen`. El codigo degrada solo: sin la columna, el borrado
-- de caja detecta las filas automaticas por el prefijo del concepto
-- ("Devolución ", "Nota de crédito ", "Costo de mercadería") y los insert
-- reintentan sin `origen`.

ALTER TABLE movimientos_caja
  DROP CONSTRAINT IF EXISTS movimientos_caja_origen_check;

ALTER TABLE movimientos_caja
  DROP COLUMN IF EXISTS origen;
