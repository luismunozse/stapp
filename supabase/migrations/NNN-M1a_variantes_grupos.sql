-- M1a: product variant groups (change variantes-inventario-venta). Additive, re-runnable.
--
-- A variant is a plain `inventario` row linked to a group by `grupo_id`, with its own
-- code, barcode, price, stock, photo and gallery. This file adds the group table, the
-- two columns and their integrity checks, the canonical key, validity and name
-- functions, the sibling sync trigger and the ungroup trigger. Nothing reads any of it
-- until the app code lands, so applying it changes no behavior.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
--
-- APPLY OFF-PEAK. Locks, all held until the transaction ends:
--   * ACCESS EXCLUSIVE on `inventario` (ADD COLUMN, constraints, indexes, trigger);
--   * SHARE ROW EXCLUSIVE on `organizations` and `users` (the new table's foreign
--     keys), which blocks writes to them for the few seconds the file runs.
-- The new table and every function are created BEFORE the first ALTER TABLE on
-- `inventario`, so its ACCESS EXCLUSIVE window covers only that ALTER, two index builds
-- and one trigger. lock_timeout bounds the WAIT for a lock, not the time it is held; if
-- it aborts, nothing was applied: re-run it.
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
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Target of the composite FK on `inventario`: a child can only join a group of its own
  -- org. It also serves every lookup by organization_id.
  CONSTRAINT inventario_grupos_org_id_uniq UNIQUE (organization_id, id)
);

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

-- Canonical key of a combination: values only, in option order, folded for case,
-- surrounding whitespace and the accents below. n-tilde is NOT folded ("Año" <> "Ano").
-- Not unaccent() (not IMMUTABLE) and not NFD (it would fold n-tilde).
-- btrim(x) alone removes only spaces. The explicit set is exactly what JavaScript's
-- String.prototype.trim() removes (tab, VT, FF, CR, LF, NBSP, U+1680, U+2000-200A,
-- U+2028/9, U+202F, U+205F, U+3000, BOM), so the SQL and JS keys agree on pasted text.
CREATE OR REPLACE FUNCTION inventario_combinacion_clave(p_atributos JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT string_agg(
           translate(lower(btrim(a.e ->> 'valor',
                     E' \t\n\f\r\u000b\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')),
                     'áàäâéèëêíìïîóòöôúùüû', 'aaaaeeeeiiiioooouuuu'),
           chr(31) ORDER BY a.ord)
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_atributos) = 'array' THEN p_atributos ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS a(e, ord)
$$;

-- A grouped row's atributos must give every combination a real key: a non-empty array
-- whose elements all carry a string `valor` that is not blank (after the same trim) and
-- does not contain the key separator. Otherwise string_agg would skip a NULL value and
-- two different combinations could collide, or a missing key would escape the unique index.
CREATE OR REPLACE FUNCTION inventario_atributos_validos(p_atributos JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN jsonb_typeof(p_atributos) = 'array' AND jsonb_array_length(p_atributos) > 0
              THEN NOT EXISTS (
                     SELECT 1 FROM jsonb_array_elements(p_atributos) AS a(e)
                      WHERE jsonb_typeof(a.e -> 'valor') IS DISTINCT FROM 'string'
                         OR COALESCE(length(public.inventario_combinacion_clave(jsonb_build_array(a.e))), 0) = 0
                         OR strpos(a.e ->> 'valor', chr(31)) > 0)
              ELSE false END
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

-- Shared fields stay equal across ALL rows of a group, whichever writer commits (form,
-- bulk set_category, import, v1 API). Any child fans out to the whole group, archived
-- rows and the firing row included; rows that already match are skipped. Including the
-- firing row is what makes a bulk UPDATE with divergent values converge: the row
-- processed last wins for the whole group, so siblings always end up identical. The
-- fan-out stays inside the org of the firing row. The transaction-local GUC stops the
-- fan-out from re-triggering itself, and lets the save RPC write every shared field in
-- one statement with the fan-out off.
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
  WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id
    AND (i.descripcion, i.categoria, i.tipo_dispositivo, i.proveedor, i.proveedor_id,
         i.dias_garantia_default, i.trackea_lotes, i.trackea_series, i.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento);
  PERFORM set_config('stapp.sync_grupo', 'off', true);
  RETURN NULL;
END;
$$;

-- Ungroup = DELETE the group row. This trigger frees every child in one statement:
-- grupo_id AND atributos both NULL, as the CHECK on `inventario` requires; the FK
-- ON DELETE SET NULL then finds nothing left to do. Children keep every other column and
-- nothing is archived. The UPDATE touches no shared column, so the sync trigger does not
-- fire. During an organization purge the org row is already gone and its cascades delete
-- the children: updating them here would only queue FK rechecks against the deleted org,
-- so the trigger steps aside.
CREATE OR REPLACE FUNCTION inventario_grupos_limpiar_atributos()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;
  UPDATE inventario SET grupo_id = NULL, atributos = NULL WHERE grupo_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS inventario_grupos_before_delete ON inventario_grupos;
CREATE TRIGGER inventario_grupos_before_delete
  BEFORE DELETE ON inventario_grupos
  FOR EACH ROW EXECUTE FUNCTION inventario_grupos_limpiar_atributos();

-- From here on `inventario` is locked (ACCESS EXCLUSIVE) until the file ends.
-- atributos is an ordered array, [{"opcion":"Color","valor":"Rojo"}, ...], in option order.
-- The FK is composite so a child can only join a group of its own org; SET NULL (grupo_id)
-- leaves organization_id alone (the column list needs PostgreSQL 15+; production is 17).
-- The constraints are dropped and re-added in the same
-- statement: re-runnable, no gap. The existing rows have both columns NULL, so the checks
-- validate on the spot. A kit can never be a child.
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS grupo_id  TEXT,
  ADD COLUMN IF NOT EXISTS atributos JSONB,
  DROP CONSTRAINT IF EXISTS inventario_grupo_id_fkey,
  DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit,
  DROP CONSTRAINT IF EXISTS inventario_grupo_atributos,
  ADD CONSTRAINT inventario_grupo_id_fkey FOREIGN KEY (organization_id, grupo_id)
    REFERENCES inventario_grupos (organization_id, id) ON DELETE SET NULL (grupo_id),
  ADD CONSTRAINT inventario_grupo_no_kit CHECK (grupo_id IS NULL OR es_kit IS NOT TRUE),
  ADD CONSTRAINT inventario_grupo_atributos CHECK (
    CASE WHEN grupo_id IS NULL THEN atributos IS NULL
         ELSE inventario_atributos_validos(atributos) END);

CREATE INDEX IF NOT EXISTS inventario_grupo_idx ON inventario (grupo_id) WHERE grupo_id IS NOT NULL;

-- One ACTIVE child per combination. Archived rows do not block re-adding it.
CREATE UNIQUE INDEX IF NOT EXISTS inventario_grupo_combinacion_activa_uniq
  ON inventario (grupo_id, inventario_combinacion_clave(atributos))
  WHERE grupo_id IS NOT NULL AND deleted_at IS NULL;

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
