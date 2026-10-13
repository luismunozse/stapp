-- Rollback de 352_recepcion_descuento.sql
--
-- Quita el descuento de lote de recepciones.
-- PERDIDA DE DATOS: se borran descuento_tipo y descuento_valor de todas las
-- recepciones (a la fecha de la migracion ninguna tenia descuento).
-- Antes de correrlo, deshacer 354 y 353 (la funcion entregar_lote_recepcion
-- no depende de estas columnas, pero la ruta y la UI del lote si).
--
--   SELECT id, descuento_tipo, descuento_valor FROM recepciones WHERE descuento_tipo IS NOT NULL;

ALTER TABLE recepciones DROP CONSTRAINT IF EXISTS recepciones_descuento_check;

ALTER TABLE recepciones
  DROP COLUMN IF EXISTS descuento_tipo,
  DROP COLUMN IF EXISTS descuento_valor;
