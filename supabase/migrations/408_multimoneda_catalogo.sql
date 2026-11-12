-- ============================================================================
-- 408 (multimoneda S4): one currency per variant group + kit cost with converted components.
-- Re-runnable. Changes no data: every write below lives inside a function body.
-- ============================================================================
-- Prerequisite: 355 (variant groups), 361 (guardar_grupo_variantes), 365 (inventario.moneda) and
-- 177 (kits). guardar_grupo_variantes (361) is NOT redefined (4. wraps it).
--
--   1. inventario_sync_compartidos_grupo() (355) also syncs `moneda`: changing the currency of one
--      variant changes it for the whole group (archived members included), like the other shared
--      fields. The trigger is redefined with `moneda` in its UPDATE OF list and WHEN tuple.
--      The trigger is AFTER UPDATE ... FOR EACH ROW (as in 355), so a group-wide
--      `UPDATE inventario SET moneda = $x WHERE grupo_id = $g` (the variant-group PUT route) finishes
--      every row before any queued propagation runs; each propagation then finds no row whose moneda
--      IS DISTINCT FROM NEW.moneda and updates nothing (no re-update of a row the statement already
--      changed). The stapp.sync_grupo GUC still stops the fan-out from re-triggering itself.
--   2. New BEFORE INSERT OR UPDATE OF grupo_id trigger inventario_moneda_grupo:
--        * INSERT into a group that already has a member: the row takes the group's currency
--          (whatever the INSERT said). This also covers the rows guardar_grupo_variantes inserts,
--          so it deliberately does NOT look at stapp.sync_grupo.
--        * UPDATE that really changes grupo_id (OLD IS DISTINCT FROM NEW) into a group where a
--          member's moneda IS DISTINCT FROM NEW.moneda: RAISE 'MONEDA_GRUPO_MIXTA' (23514). The app
--          maps that message to a 400. A plain UPDATE ... SET moneda never raises.
--   3. calcular_costo_kit gains (p_moneda, p_tipo_cambio, p_unidad), all defaulted, so the existing
--      2-argument call keeps working and returns the same value for kits with only local
--      components. If a direct component is priced in a currency other than p_moneda, or the rate is
--      missing/<= 0, the cost is unknown: NULL (a 2-argument call on such a kit now returns NULL
--      instead of adding foreign and local amounts). The old (TEXT, TEXT) overload is dropped first,
--      otherwise two overloads would remain and PostgREST could not choose.
--   4. New guardar_grupo_variantes_moneda(<the 7 arguments of guardar_grupo_variantes>, p_moneda):
--      the variant-group PUT route calls it instead of guardar_grupo_variantes when the save also
--      changes the group's currency, so the converted prices and the new currency commit in ONE
--      transaction (before, the route ran a second UPDATE after the RPC had committed). It calls
--      guardar_grupo_variantes unchanged and then sets moneda on every row of that group in p_org.
--      SECURITY INVOKER and service_role only, like guardar_grupo_variantes.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- LOCKS: CREATE [OR REPLACE] TRIGGER takes SHARE ROW EXCLUSIVE on `inventario` (blocks writes, not
-- reads) until the transaction ends. The sync trigger is replaced with CREATE OR REPLACE TRIGGER
-- (PostgreSQL 14+, production is 17) instead of DROP TRIGGER + CREATE TRIGGER, because DROP TRIGGER
-- takes ACCESS EXCLUSIVE (it would block reads too). Functions take no table lock. The two trigger
-- statements are the last ones, so the write block is as short as possible.
-- lock_timeout bounds the WAIT, not the hold; if it aborts, nothing was applied: re-run it.
--
-- Rollback: rollback/408_rollback.sql. Probes: verify/408_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Kit cost (no table lock)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS calcular_costo_kit(TEXT, TEXT);

CREATE OR REPLACE FUNCTION calcular_costo_kit(
  p_kit_id      TEXT,
  p_org_id      TEXT,
  p_moneda      TEXT DEFAULT NULL,
  p_tipo_cambio NUMERIC DEFAULT NULL,
  p_unidad      NUMERIC DEFAULT 0
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_costo NUMERIC;
BEGIN
  -- A component in another currency, or no usable rate: the cost cannot be stated in local currency.
  IF EXISTS (
    SELECT 1
      FROM inventario_kit_items ki
      JOIN inventario inv ON inv.id = ki.componente_id
     WHERE ki.kit_id = p_kit_id
       AND ki.organization_id = p_org_id
       AND inv.moneda IS NOT NULL
       AND (inv.moneda IS DISTINCT FROM p_moneda OR p_tipo_cambio IS NULL OR p_tipo_cambio <= 0)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(ki.cantidad * CASE
           WHEN inv.moneda IS NULL THEN COALESCE(inv.precio_compra, 0)
           WHEN p_unidad > 0 THEN ROUND(COALESCE(inv.precio_compra, 0) * p_tipo_cambio / p_unidad) * p_unidad
           ELSE ROUND(COALESCE(inv.precio_compra, 0) * p_tipo_cambio, 2)
         END), 0)
    INTO v_costo
  FROM inventario_kit_items ki
  JOIN inventario inv ON inv.id = ki.componente_id
  WHERE ki.kit_id = p_kit_id
    AND ki.organization_id = p_org_id;

  RETURN v_costo;
END;
$$;

COMMENT ON FUNCTION calcular_costo_kit(TEXT, TEXT, TEXT, NUMERIC, NUMERIC) IS
  'Suma (cantidad * precio_compra) de cada componente directo de un kit, en moneda local. Un componente en p_moneda se convierte con p_tipo_cambio (redondeo a p_unidad si > 0, si no a 2 decimales). NULL si un componente esta en otra divisa o falta el tipo de cambio. NO explosiona sub-kits.';

GRANT EXECUTE ON FUNCTION calcular_costo_kit(TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1b. Save a variant group and change its currency in one transaction (no table lock)
-- ----------------------------------------------------------------------------
-- ORDER: the save runs FIRST, in the group's current currency, and the currency changes AFTER.
--   * During the inner save every existing member still has the old currency, so a new row inherits
--     it on INSERT (inventario_moneda_grupo) and a promoted item is checked against it: exactly what
--     a save without a currency change does. It cannot raise MONEDA_GRUPO_MIXTA for a reason the
--     plain save would not.
--   * The currency is then set with a plain UPDATE ... SET moneda on the whole group. That trigger
--     fires only on INSERT or UPDATE OF grupo_id, so this statement never raises MONEDA_GRUPO_MIXTA;
--     the sync trigger (AFTER ROW) finds every member already changed and propagates nothing.
--   The opposite order (currency first) would make a promoted item of the old currency raise, and a
--   group whose rows are all new would still need the UPDATE after the save.
-- Scope: guardar_grupo_variantes validates p_grupo and refuses a group of another organization
-- (P0002) before writing; the UPDATE is still filtered by the group id AND p_org, so it touches no
-- other group and no row of another organization.
CREATE OR REPLACE FUNCTION guardar_grupo_variantes_moneda(
  p_org TEXT, p_user TEXT, p_grupo JSONB, p_compartidos JSONB, p_variantes JSONB,
  p_archivar JSONB, p_deposito_inicial TEXT, p_moneda TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF p_moneda IS NOT NULL AND p_moneda NOT IN ('USD', 'EUR') THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_moneda must be NULL, USD or EUR' USING ERRCODE = '22023';
  END IF;
  v_res := guardar_grupo_variantes(p_org, p_user, p_grupo, p_compartidos, p_variantes, p_archivar, p_deposito_inicial);
  UPDATE inventario SET moneda = p_moneda
   WHERE grupo_id = p_grupo ->> 'id' AND organization_id = p_org
     AND moneda IS DISTINCT FROM p_moneda;
  RETURN v_res;
END;
$$;

COMMENT ON FUNCTION guardar_grupo_variantes_moneda(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT) IS
  'guardar_grupo_variantes + cambio de moneda de todo el grupo (p_moneda NULL = local) en la misma transaccion. Solo service_role.';

REVOKE EXECUTE ON FUNCTION guardar_grupo_variantes_moneda(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guardar_grupo_variantes_moneda(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Shared fields of a variant group now include moneda (355 + moneda)
-- ----------------------------------------------------------------------------
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
    dias_alerta_vencimiento = NEW.dias_alerta_vencimiento, moneda = NEW.moneda
  WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id
    AND (i.descripcion, i.categoria, i.tipo_dispositivo, i.proveedor, i.proveedor_id,
         i.dias_garantia_default, i.trackea_lotes, i.trackea_series, i.dias_alerta_vencimiento, i.moneda)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento, NEW.moneda);
  PERFORM set_config('stapp.sync_grupo', 'off', true);
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. A row entering a group takes, or must already have, the group's currency
-- ----------------------------------------------------------------------------
-- "The group's currency" is that of any other member (same org), archived members included: the
-- sync trigger keeps them all equal. Only groups with at least one other member constrain anything.
CREATE OR REPLACE FUNCTION inventario_moneda_grupo()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_moneda CHAR(3);
BEGIN
  IF NEW.grupo_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT i.moneda INTO v_moneda
      FROM inventario i
     WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id AND i.id <> NEW.id
     ORDER BY i.id
     LIMIT 1;
    IF FOUND THEN
      NEW.moneda := v_moneda;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE OF grupo_id fires even when the value is unchanged (the save RPC rewrites it): only a
  -- real move into a group is checked.
  IF OLD.grupo_id IS NOT DISTINCT FROM NEW.grupo_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM inventario i
              WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id AND i.id <> NEW.id
                AND i.moneda IS DISTINCT FROM NEW.moneda) THEN
    RAISE EXCEPTION 'MONEDA_GRUPO_MIXTA'
      USING ERRCODE = '23514',
            DETAIL = format('item %s (moneda %s) no puede unirse al grupo %s: otra moneda', NEW.id, COALESCE(NEW.moneda, 'local'), NEW.grupo_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Triggers (SHARE ROW EXCLUSIVE on inventario until the end: last statements)
-- ----------------------------------------------------------------------------
-- Same definition as 355 plus moneda. CREATE OR REPLACE TRIGGER: no ACCESS EXCLUSIVE (see header).
CREATE OR REPLACE TRIGGER inventario_sync_compartidos_grupo
  AFTER UPDATE OF descripcion, categoria, tipo_dispositivo, proveedor, proveedor_id,
                  dias_garantia_default, trackea_lotes, trackea_series, dias_alerta_vencimiento, moneda
  ON inventario
  FOR EACH ROW
  WHEN (NEW.grupo_id IS NOT NULL AND
        (OLD.descripcion, OLD.categoria, OLD.tipo_dispositivo, OLD.proveedor, OLD.proveedor_id,
         OLD.dias_garantia_default, OLD.trackea_lotes, OLD.trackea_series, OLD.dias_alerta_vencimiento, OLD.moneda)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento, NEW.moneda))
  EXECUTE FUNCTION inventario_sync_compartidos_grupo();

CREATE OR REPLACE TRIGGER inventario_moneda_grupo
  BEFORE INSERT OR UPDATE OF grupo_id ON inventario
  FOR EACH ROW EXECUTE FUNCTION inventario_moneda_grupo();
