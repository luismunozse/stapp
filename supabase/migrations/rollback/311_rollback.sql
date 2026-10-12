-- Rollback de la migracion 311.
--
-- Se pierde el vinculo entre una cotizacion reemplazada y su revision. Las
-- filas siguen existiendo: la aceptada conserva su firma y sus items, y la
-- revision conserva los suyos. Lo que vuelve es el doble conteo — el
-- presupuesto de una orden con revision va a sumar las dos versiones.
--
-- Revertir el codigo de la app junto con esto.

DROP INDEX IF EXISTS cotizaciones_reemplazada_por_idx;

ALTER TABLE cotizaciones
  DROP COLUMN IF EXISTS reemplazada_por,
  DROP COLUMN IF EXISTS revision_de;
