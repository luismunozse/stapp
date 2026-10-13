-- Rollback of M1a (variantes-inventario-venta): removes the variant group schema.
--
-- WHAT IS LOST: the groups (inventario_grupos rows: base name and option definitions)
-- and every child's grupo_id/atributos. Groups are lost, children survive: each former
-- child stays a valid standalone `inventario` row with its name, code, barcode, prices,
-- stock, movements, sales history, photo and gallery untouched.
--
-- The group definition cannot be rebuilt from the children alone. Export it first:
--
--   SELECT g.id, g.organization_id, g.nombre, g.opciones,
--          (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'atributos', i.atributos,
--                                               'activo', i.deleted_at IS NULL))
--             FROM inventario i WHERE i.grupo_id = g.id) AS hijos
--     FROM inventario_grupos g;
--
-- Revert M1b first (the guardar_grupo_variantes RPC reads these columns and would fail at
-- runtime once they are gone), and revert the app code that reads the groups before that.
-- Safe to run before any of it ships. Drop order follows the dependencies: triggers,
-- trigger functions, the unique index, then the checks and columns (one ALTER), then the
-- functions those checks and the index used, then the table.
--
-- LOCKS (held until the transaction ends): ACCESS EXCLUSIVE on `inventario` for the ALTER,
-- and ACCESS EXCLUSIVE on `inventario_grupos` for the DROP TABLE. Run it off-peak.
-- lock_timeout bounds the wait, not the hold; if it aborts, nothing was applied: re-run it.

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS inventario_sync_compartidos_grupo ON inventario;
DROP TRIGGER IF EXISTS inventario_grupos_before_delete ON inventario_grupos;
DROP FUNCTION IF EXISTS inventario_sync_compartidos_grupo();
DROP FUNCTION IF EXISTS inventario_grupos_limpiar_atributos();
DROP INDEX IF EXISTS inventario_grupo_combinacion_activa_uniq;
DROP INDEX IF EXISTS inventario_grupo_idx;

ALTER TABLE inventario
  DROP CONSTRAINT IF EXISTS inventario_grupo_atributos,
  DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit,
  DROP CONSTRAINT IF EXISTS inventario_grupo_id_fkey,
  DROP COLUMN IF EXISTS grupo_id,
  DROP COLUMN IF EXISTS atributos;

DROP FUNCTION IF EXISTS inventario_atributos_validos(JSONB);
DROP FUNCTION IF EXISTS inventario_combinacion_clave(JSONB);
DROP FUNCTION IF EXISTS inventario_nombre_variante(TEXT, JSONB);

DROP TABLE IF EXISTS inventario_grupos;
