-- Rollback de la migracion 307.
--
-- Devuelve el trigger de siembra de tipos base y saca la columna `rubro`.
-- La funcion `poblar_tipos_dispositivo_base()` nunca se borro, asi que el
-- trigger vuelve a apuntar a la misma implementacion que tenia.
--
-- OJO: si se aplico 307 y despues se registraron organizaciones de otros
-- rubros, este rollback hace que cualquier alta NUEVA vuelva a nacer con los
-- ocho tipos de electronica. No toca las organizaciones ya sembradas.

CREATE TRIGGER trigger_organization_tipos_dispositivo
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION on_organization_created_tipos();

DROP INDEX IF EXISTS organizations_rubro_idx;

ALTER TABLE organizations DROP COLUMN IF EXISTS rubro;
