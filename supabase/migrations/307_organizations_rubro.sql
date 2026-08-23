-- Migration 307: rubro por organizacion + baja del trigger de siembra.
--
-- Hasta ahora el trigger `trigger_organization_tipos_dispositivo` (migraciones
-- 014 -> 021 -> 092) sembraba OCHO tipos de electronica en toda organizacion
-- nueva, sin saber a que se dedicaba. Un taller mecanico nacia con "Celular",
-- "Tablet" y "Consola" antes de ver la primera pantalla.
--
-- La siembra pasa a la aplicacion (`lib/rubros/seed.ts`), que lee el pack del
-- rubro elegido en el registro. Eso deja UNA sola fuente de verdad: hasta hoy
-- los tipos base estaban escritos dos veces (esta funcion SQL y `ensureTiposExist`
-- en app/api/tipos-dispositivo/route.ts) y podian divergir en silencio.
--
-- No toca los tipos de ninguna organizacion existente.

-- 1) Rubro de la organizacion. NULL = no eligio (orgs viejas y cualquier alta
--    que no pase por el registro); `getRubro()` cae al pack genérico.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rubro TEXT;

COMMENT ON COLUMN organizations.rubro IS
  'Pack de rubro elegido en el registro. Ids validos en lib/rubros/index.ts. NULL cae al generico.';

-- 2) Backfill: todo lo que ya existe es electronica — es lo unico que el
--    trigger sabia sembrar, y coincide con la base instalada.
UPDATE organizations SET rubro = 'electronica' WHERE rubro IS NULL;

-- 3) Baja del trigger. La funcion `poblar_tipos_dispositivo_base()` queda en la
--    base a proposito: es inofensiva sin trigger que la llame y permite revertir
--    esta migracion con un solo CREATE TRIGGER (ver 307_rollback.sql).
DROP TRIGGER IF EXISTS trigger_organization_tipos_dispositivo ON organizations;

-- 4) Indice para el reporte de altas por rubro. Parcial: las filas sin rubro no
--    aportan nada a esa lectura.
CREATE INDEX IF NOT EXISTS organizations_rubro_idx
  ON organizations(rubro)
  WHERE rubro IS NOT NULL;
