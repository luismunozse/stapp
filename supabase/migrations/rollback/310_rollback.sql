-- Rollback de la migracion 310.
--
-- Devuelve iva_tasa a NOT NULL DEFAULT 21. Las filas que la 310 dejo en NULL
-- vuelven a 21, que es exactamente el valor que tenian antes de aplicarla.
--
-- No se pierde ninguna tasa configurada a mano: la 310 solo vacio filas con
-- iva_regimen = 'EXENTO' e iva_tasa = 21.
--
-- Despues de este rollback hay que volver tambien el codigo de la app: con la
-- columna NOT NULL el fallback por pais de getIvaGeneral deja de alcanzarse
-- para orgs existentes, y toda org nueva vuelve a nacer en 21.

UPDATE organizations SET iva_tasa = 21 WHERE iva_tasa IS NULL;

ALTER TABLE organizations
  ALTER COLUMN iva_tasa SET DEFAULT 21,
  ALTER COLUMN iva_tasa SET NOT NULL;
