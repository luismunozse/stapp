-- M1a: product variant groups (change variantes-inventario-venta). Additive, re-runnable.
--
-- A variant is a plain `inventario` row linked to a group by `grupo_id`, with its own
-- code, barcode, price, stock, photo and gallery. This file adds the group table, the
-- two columns, the canonical key and name functions, the sibling sync trigger and the
-- ungroup trigger. Nothing reads any of it until the app code lands, so applying it
-- changes no behavior.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
--
-- APPLY OFF-PEAK. The ADD COLUMN and ADD CONSTRAINT on `inventario` hold an
-- ACCESS EXCLUSIVE lock until the transaction ends. lock_timeout bounds the WAIT for
-- the lock, not the time it is held; if it aborts, nothing was applied: re-run it.
--
-- Image columns (imagen_url, imagen_path) and the gallery are deliberately absent from
-- every trigger and function below: one stored file is referenced by exactly one row.

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS inventario_grupos (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 200),
  -- [{"nombre":"Color","valores":["Rojo","Azul"]}], 1 to 3 options
  opciones        JSONB NOT NULL CHECK (
                    CASE WHEN jsonb_typeof(opciones) = 'array'
                         THEN jsonb_array_length(opciones) BETWEEN 1 AND 3
                         ELSE false END),
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- atributos is an ordered array, [{"opcion":"Color","valor":"Rojo"}, ...], in option order.
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS grupo_id  TEXT REFERENCES inventario_grupos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atributos JSONB;

-- Canonical key of a combination: values only, in option order, folded for case,
-- surrounding spaces and the accents below. n-tilde is NOT folded ("Año" <> "Ano").
-- Not unaccent() (not IMMUTABLE) and not NFD (it would fold n-tilde).
CREATE OR REPLACE FUNCTION inventario_combinacion_clave(p_atributos JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT string_agg(
           translate(lower(btrim(a.e ->> 'valor')), 'áàäâéèëêíìïîóòöôúùüû', 'aaaaeeeeiiiioooouuuu'),
           chr(31) ORDER BY a.ord)
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_atributos) = 'array' THEN p_atributos ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS a(e, ord)
$$;

-- "{base} - {Value1} / {Value2}" in option order; just the base when there are no values.
CREATE OR REPLACE FUNCTION inventario_nombre_variante(p_base TEXT, p_atributos JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    p_base || ' - ' || (
      SELECT string_agg(a.e ->> 'valor', ' / ' ORDER BY a.ord)
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p_atributos) = 'array' THEN p_atributos ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS a(e, ord)),
    p_base)
$$;

CREATE INDEX IF NOT EXISTS inventario_grupos_org_idx ON inventario_grupos (organization_id);
CREATE INDEX IF NOT EXISTS inventario_grupo_idx ON inventario (grupo_id) WHERE grupo_id IS NOT NULL;

-- One ACTIVE child per combination. Archived rows do not block re-adding it.
CREATE UNIQUE INDEX IF NOT EXISTS inventario_grupo_combinacion_activa_uniq
  ON inventario (grupo_id, inventario_combinacion_clave(atributos))
  WHERE grupo_id IS NOT NULL AND deleted_at IS NULL;

-- A kit can never be a child. DROP + ADD in one statement: re-runnable, no gap.
ALTER TABLE inventario
  DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit,
  ADD CONSTRAINT inventario_grupo_no_kit CHECK (grupo_id IS NULL OR es_kit IS NOT TRUE);

-- Access mirrors 201: org-scoped select, service_role everything, nothing for anon.
ALTER TABLE inventario_grupos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventario_grupos_select ON inventario_grupos;
CREATE POLICY inventario_grupos_select ON inventario_grupos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());
DROP POLICY IF EXISTS inventario_grupos_all_service ON inventario_grupos;
CREATE POLICY inventario_grupos_all_service ON inventario_grupos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.inventario_grupos FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS inventario_grupos_updated_at ON inventario_grupos;
CREATE TRIGGER inventario_grupos_updated_at
  BEFORE UPDATE ON inventario_grupos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Shared fields stay equal across the siblings of a group, whichever writer commits
-- (form, bulk set_category, import, v1 API). Any child fans out to the others, archived
-- ones included. The transaction-local GUC stops the fan-out from re-triggering itself,
-- and lets the save RPC write every shared field in one statement with the fan-out off.
-- In a bulk UPDATE with divergent values the last row processed wins.
CREATE OR REPLACE FUNCTION inventario_sync_compartidos_grupo()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('stapp.sync_grupo', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('stapp.sync_grupo', 'on', true);
  UPDATE inventario i SET
    descripcion = NEW.descripcion, categoria = NEW.categoria,
    tipo_dispositivo = NEW.tipo_dispositivo, proveedor = NEW.proveedor,
    proveedor_id = NEW.proveedor_id, dias_garantia_default = NEW.dias_garantia_default,
    trackea_lotes = NEW.trackea_lotes, trackea_series = NEW.trackea_series,
    dias_alerta_vencimiento = NEW.dias_alerta_vencimiento
  WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id AND i.id <> NEW.id
    AND (i.descripcion, i.categoria, i.tipo_dispositivo, i.proveedor, i.proveedor_id,
         i.dias_garantia_default, i.trackea_lotes, i.trackea_series, i.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento);
  PERFORM set_config('stapp.sync_grupo', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS inventario_sync_compartidos_grupo ON inventario;
CREATE TRIGGER inventario_sync_compartidos_grupo
  AFTER UPDATE OF descripcion, categoria, tipo_dispositivo, proveedor, proveedor_id,
                  dias_garantia_default, trackea_lotes, trackea_series, dias_alerta_vencimiento
  ON inventario
  FOR EACH ROW
  WHEN (NEW.grupo_id IS NOT NULL AND
        (OLD.descripcion, OLD.categoria, OLD.tipo_dispositivo, OLD.proveedor, OLD.proveedor_id,
         OLD.dias_garantia_default, OLD.trackea_lotes, OLD.trackea_series, OLD.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento))
  EXECUTE FUNCTION inventario_sync_compartidos_grupo();

-- Ungroup = DELETE the group row. This clears atributos; the FK ON DELETE SET NULL then
-- frees grupo_id. Children keep every other column and nothing is archived. The UPDATE
-- touches no shared column, so the sync trigger does not fire.
CREATE OR REPLACE FUNCTION inventario_grupos_limpiar_atributos()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE inventario SET atributos = NULL WHERE grupo_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS inventario_grupos_before_delete ON inventario_grupos;
CREATE TRIGGER inventario_grupos_before_delete
  BEFORE DELETE ON inventario_grupos
  FOR EACH ROW EXECUTE FUNCTION inventario_grupos_limpiar_atributos();
