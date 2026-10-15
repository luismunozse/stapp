-- Verification of M2 (variantes-inventario-venta): the legacy per-product variants are gone.
--
-- Run AFTER M2 is applied:  node scripts/db-run.mjs supabase/migrations/verify/<NNN>_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Without RLS, as in verify/README.md. Run the read-only pre-check BEFORE M2, not this file.
--
-- WHAT IT DOES, in two parts. Results accumulate in _r and come out in ONE select.
--   Part 1 (orden 10-21) reads the REAL state after M2: the table, the four functions and the
--          policies are gone, no trigger on a variants table writes inventario.stock (VL-4), the
--          tiene_variantes column is still there and no item carries the flag, the catalog variants
--          and the variant groups were not touched. Orden 21 is informational: how many active items
--          have a stock that differs from the sum of their depósitos (not caused by M2, it is the
--          invariant VL-4 protects going forward).
--   Part 2 (orden 80+) is a REHEARSAL inside the transaction: it recreates the legacy objects with
--          the rollback file (copied inline, verbatim), inserts one scratch legacy row and checks that
--          the M2 GUARD refuses (SQLSTATE 55000) and leaves table and row alone; then it removes the
--          row and runs the migration itself (inline, verbatim) and checks that everything goes away,
--          the flagged scratch item is cleared and the item survives. Everything is rolled back.
--          The VL-4 check runs again in the rehearsal while the legacy trigger exists, to prove that
--          it can see one (a probe that can only answer 0 proves nothing).
--
-- LOCKS: the rehearsal creates and drops a table with foreign keys to `inventario` and
-- `organizations`, which takes ACCESS EXCLUSIVE on both until the final ROLLBACK. Run it off-peak.
--
-- Green = esperado equals obtenido, obtenido starts with 'OK:' for the probes that expect an error,
-- and starts with 'INFO' for orden 21.
-- Checked on a local Postgres 16 engine (PGlite) against 176 + 201 + M2, including a mutation sweep.
-- Nothing was written to production: the first real run is after M2 is applied.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Runs one statement and records the SQLSTATE it raised ('ok' = no error).
CREATE FUNCTION pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_msg TEXT := '';
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE; v_msg := ' ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado,
    CASE WHEN v_got = p_esperado THEN 'OK: ' || v_got ELSE 'FALLO: ' || v_got || v_msg END);
END $$;

-- VL-4: triggers on a variants table that write inventario.stock, plus any trigger at all that runs the
-- legacy sync function. After M2 there must be none; with the legacy objects back there must be one.
CREATE FUNCTION pg_temp.stock_writers() RETURNS BIGINT LANGUAGE sql AS $$
  SELECT count(*)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
     AND ((c.relname LIKE '%variantes%' AND p.prosrc ILIKE '%update inventario%')
          OR t.tgfoid::regproc::text LIKE '%sync_inventario_total_variantes%')
$$;

-- ---------------------------------------------------------------------------------------------
-- PART 1: the real state after M2
-- ---------------------------------------------------------------------------------------------
INSERT INTO _r SELECT 10, 'the legacy table is gone', 'true',
  (to_regclass('public.inventario_variantes') IS NULL)::TEXT;
INSERT INTO _r SELECT 11, 'the legacy function and the three RPCs are gone', '0',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_inventario_total_variantes', 'crear_variantes_bulk',
                        'ajustar_stock_variante_atomic', 'eliminar_variantes_y_consolidar'))::TEXT;
INSERT INTO _r SELECT 12, 'no policy is left on the legacy table', '0',
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inventario_variantes')::TEXT;
INSERT INTO _r SELECT 13, 'VL-4: no trigger on a variants table writes inventario.stock, none runs the sync function', '0',
  pg_temp.stock_writers()::TEXT;

INSERT INTO _r SELECT 14, 'tiene_variantes is still BOOLEAN NOT NULL DEFAULT false (M2 does not drop the column)', 'boolean|NO|false',
  COALESCE((SELECT data_type || '|' || is_nullable || '|' || column_default
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inventario'
               AND column_name = 'tiene_variantes'), 'MISSING');
INSERT INTO _r SELECT 15, 'no item carries the legacy flag any more', '0',
  (SELECT count(*) FROM inventario WHERE tiene_variantes IS TRUE)::TEXT;
INSERT INTO _r SELECT 16, 'real inventory exists (so probe 15 is not vacuous)', 'true',
  (SELECT count(*) > 0 FROM inventario WHERE codigo NOT LIKE 'PRB-M2-%')::TEXT;

INSERT INTO _r SELECT 17, 'the catalog variants table is untouched', 'true',
  (to_regclass('public.catalogo_variantes') IS NOT NULL)::TEXT;
INSERT INTO _r SELECT 18, 'the variant groups are untouched: table and save RPC exist', 'true',
  (to_regclass('public.inventario_grupos') IS NOT NULL
   AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'guardar_grupo_variantes'))::TEXT;
INSERT INTO _r SELECT 19, 'the shared updated_at trigger function survives', 'true',
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at')::TEXT;
INSERT INTO _r SELECT 20, 'the column comment no longer promises the sync trigger', 'true',
  COALESCE((SELECT col_description(a.attrelid, a.attnum) ILIKE '%legacy%'
              AND col_description(a.attrelid, a.attnum) NOT ILIKE '%sync_inventario_total_variantes%'
              FROM pg_attribute a
             WHERE a.attrelid = 'public.inventario'::regclass
               AND a.attname = 'tiene_variantes' AND NOT a.attisdropped), false)::TEXT;
INSERT INTO _r SELECT 21, 'informational: active items whose stock differs from the sum of their depósitos', 'INFO',
  'INFO: ' || (SELECT count(*) FROM inventario i
                WHERE i.deleted_at IS NULL
                  AND i.stock <> COALESCE((SELECT sum(d.stock) FROM inventario_depositos d
                                            WHERE d.inventario_id = i.id), 0))::TEXT || ' item(s)';

-- ---------------------------------------------------------------------------------------------
-- PART 2: rehearsal (rolled back with everything else)
-- ---------------------------------------------------------------------------------------------
-- Bring the legacy objects back: the rollback file, inline and verbatim.
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

COMMENT ON COLUMN inventario.tiene_variantes IS
  'Si true: stock/stock_reservado se calculan automáticamente sumando inventario_variantes vía trigger sync_inventario_total_variantes.';

CREATE TABLE IF NOT EXISTS inventario_variantes (
  id                TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id     TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  atributos         JSONB NOT NULL DEFAULT '{}'::jsonb,
  codigo_variante   TEXT NOT NULL,
  barcode           TEXT,
  stock             INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_reservado   INTEGER NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
  precio_compra     NUMERIC(12,2),
  precio_venta      NUMERIC(12,2),
  imagen_url        TEXT,
  imagen_path       TEXT,
  activo            BOOLEAN NOT NULL DEFAULT true,
  orden             INTEGER NOT NULL DEFAULT 0,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventario_variantes_reservado_le_stock CHECK (stock_reservado <= stock),
  CONSTRAINT inventario_variantes_nombre_len CHECK (length(nombre) BETWEEN 1 AND 200),
  CONSTRAINT inventario_variantes_codigo_len CHECK (length(codigo_variante) BETWEEN 1 AND 80)
);

-- Unicidad de codigo_variante por item (sólo activos no borrados)
CREATE UNIQUE INDEX IF NOT EXISTS inventario_variantes_codigo_unique
  ON inventario_variantes(inventario_id, codigo_variante)
  WHERE deleted_at IS NULL;

-- Unicidad de barcode por organización (sólo activos no borrados con barcode)
CREATE UNIQUE INDEX IF NOT EXISTS inventario_variantes_barcode_unique
  ON inventario_variantes(organization_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS inventario_variantes_inv_idx
  ON inventario_variantes(inventario_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inventario_variantes_org_idx
  ON inventario_variantes(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inventario_variantes_barcode_idx
  ON inventario_variantes(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inventario_variantes_activo_idx
  ON inventario_variantes(inventario_id, orden) WHERE activo = true AND deleted_at IS NULL;

ALTER TABLE inventario_variantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
CREATE POLICY inventario_variantes_select ON inventario_variantes
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;
CREATE POLICY inventario_variantes_all_service ON inventario_variantes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS inventario_variantes_updated_at ON inventario_variantes;
CREATE TRIGGER inventario_variantes_updated_at
  BEFORE UPDATE ON inventario_variantes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION sync_inventario_total_variantes()
RETURNS TRIGGER AS $$
DECLARE
  v_inv_id     TEXT;
  v_stock      INTEGER;
  v_reservado  INTEGER;
  v_has_var    BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_inv_id := COALESCE(NEW.inventario_id, OLD.inventario_id);

  SELECT tiene_variantes INTO v_has_var
  FROM inventario
  WHERE id = v_inv_id;

  IF NOT FOUND OR v_has_var IS NOT TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(stock), 0),
    COALESCE(SUM(stock_reservado), 0)
  INTO v_stock, v_reservado
  FROM inventario_variantes
  WHERE inventario_id = v_inv_id
    AND deleted_at IS NULL;

  UPDATE inventario
     SET stock = v_stock,
         stock_reservado = v_reservado,
         updated_at = NOW()
   WHERE id = v_inv_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventario_variantes_sync_total ON inventario_variantes;
CREATE TRIGGER inventario_variantes_sync_total
  AFTER INSERT OR UPDATE OF stock, stock_reservado, deleted_at, activo OR DELETE
  ON inventario_variantes
  FOR EACH ROW EXECUTE FUNCTION sync_inventario_total_variantes();

CREATE OR REPLACE FUNCTION crear_variantes_bulk(
  p_inv_id      TEXT,
  p_org         TEXT,
  p_user        TEXT,
  p_variantes   JSONB
) RETURNS JSONB AS $$
DECLARE
  v_var          JSONB;
  v_codigo       TEXT;
  v_codigos      TEXT[] := ARRAY[]::TEXT[];
  v_dup_codes    TEXT[];
  v_ids          TEXT[] := ARRAY[]::TEXT[];
  v_new_id       TEXT;
  v_count        INTEGER := 0;
  v_stock_total  INTEGER := 0;
  v_existing     INTEGER;
  v_was_variant  BOOLEAN;
  v_prev_stock   INTEGER;
  v_prev_reserv  INTEGER;
BEGIN
  IF jsonb_typeof(p_variantes) <> 'array' THEN
    RAISE EXCEPTION 'p_variantes debe ser un array JSONB'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_variantes) = 0 THEN
    RAISE EXCEPTION 'p_variantes vacío'
      USING ERRCODE = '22023';
  END IF;

  -- Lock parent
  SELECT tiene_variantes, stock, stock_reservado
    INTO v_was_variant, v_prev_stock, v_prev_reserv
  FROM inventario
  WHERE id = p_inv_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de inventario no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- Validar duplicados dentro del payload
  FOR v_var IN SELECT * FROM jsonb_array_elements(p_variantes)
  LOOP
    v_codigo := trim(COALESCE(v_var->>'codigo_variante', ''));
    IF v_codigo = '' THEN
      RAISE EXCEPTION 'Cada variante requiere codigo_variante'
        USING ERRCODE = '22023';
    END IF;
    IF v_codigo = ANY(v_codigos) THEN
      RAISE EXCEPTION 'Código de variante duplicado en el lote: %', v_codigo
        USING ERRCODE = '23505';
    END IF;
    v_codigos := array_append(v_codigos, v_codigo);
  END LOOP;

  -- Validar duplicados contra existentes
  SELECT array_agg(codigo_variante)
    INTO v_dup_codes
  FROM inventario_variantes
  WHERE inventario_id = p_inv_id
    AND deleted_at IS NULL
    AND codigo_variante = ANY(v_codigos);

  IF v_dup_codes IS NOT NULL AND array_length(v_dup_codes, 1) > 0 THEN
    RAISE EXCEPTION 'Códigos de variante ya existen: %', array_to_string(v_dup_codes, ', ')
      USING ERRCODE = '23505';
  END IF;

  -- Activar flag si era false
  IF v_was_variant IS NOT TRUE THEN
    UPDATE inventario
       SET tiene_variantes = true,
           updated_at = NOW()
     WHERE id = p_inv_id;
  END IF;

  -- Insertar variantes
  FOR v_var IN SELECT * FROM jsonb_array_elements(p_variantes)
  LOOP
    INSERT INTO inventario_variantes (
      inventario_id, organization_id,
      nombre, codigo_variante, atributos, barcode,
      stock, stock_reservado,
      precio_compra, precio_venta,
      imagen_url, imagen_path,
      activo, orden
    ) VALUES (
      p_inv_id, p_org,
      v_var->>'nombre',
      v_var->>'codigo_variante',
      COALESCE(v_var->'atributos', '{}'::jsonb),
      NULLIF(trim(COALESCE(v_var->>'barcode', '')), ''),
      COALESCE((v_var->>'stock')::INTEGER, 0),
      COALESCE((v_var->>'stock_reservado')::INTEGER, 0),
      CASE WHEN v_var ? 'precio_compra' AND v_var->>'precio_compra' IS NOT NULL
           THEN (v_var->>'precio_compra')::NUMERIC ELSE NULL END,
      CASE WHEN v_var ? 'precio_venta' AND v_var->>'precio_venta' IS NOT NULL
           THEN (v_var->>'precio_venta')::NUMERIC ELSE NULL END,
      NULLIF(v_var->>'imagen_url', ''),
      NULLIF(v_var->>'imagen_path', ''),
      COALESCE((v_var->>'activo')::BOOLEAN, true),
      COALESCE((v_var->>'orden')::INTEGER, v_count)
    )
    RETURNING id INTO v_new_id;

    v_ids := array_append(v_ids, v_new_id);
    v_count := v_count + 1;
    v_stock_total := v_stock_total + COALESCE((v_var->>'stock')::INTEGER, 0);

    -- Movimiento auditable de entrada inicial
    IF COALESCE((v_var->>'stock')::INTEGER, 0) > 0 THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        referencia_id, referencia_tipo,
        usuario_id, organization_id, observaciones
      ) VALUES (
        p_inv_id, 'ENTRADA', (v_var->>'stock')::INTEGER,
        0, (v_var->>'stock')::INTEGER,
        v_new_id, 'VARIANTE',
        p_user, p_org,
        format('Stock inicial variante "%s"', v_var->>'nombre')
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'ids', to_jsonb(v_ids),
    'count', v_count
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_variantes_bulk(TEXT, TEXT, TEXT, JSONB) IS
  'Crea variantes de inventario en lote. Activa tiene_variantes en el parent. ERRCODE: P0002 item no encontrado, 23505 codigo duplicado, 22023 payload inválido.';

CREATE OR REPLACE FUNCTION ajustar_stock_variante_atomic(
  p_variante_id  TEXT,
  p_org          TEXT,
  p_user         TEXT,
  p_mode         TEXT,
  p_value        INTEGER,
  p_motivo       TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_inv_id           TEXT;
  v_stock_anterior   INTEGER;
  v_reservado        INTEGER;
  v_stock_posterior  INTEGER;
  v_cantidad         INTEGER;
  v_mov_id           TEXT;
BEGIN
  IF p_mode NOT IN ('absolute', 'delta') THEN
    RAISE EXCEPTION 'Modo inválido: %', p_mode
      USING ERRCODE = '22023';
  END IF;

  SELECT inventario_id, stock, stock_reservado
    INTO v_inv_id, v_stock_anterior, v_reservado
  FROM inventario_variantes
  WHERE id = p_variante_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante no encontrada'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_mode = 'absolute' THEN
    v_stock_posterior := p_value;
  ELSE
    v_stock_posterior := v_stock_anterior + p_value;
  END IF;

  IF v_stock_posterior < 0 THEN
    RAISE EXCEPTION 'El stock no puede quedar negativo'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_stock_posterior < v_reservado THEN
    RAISE EXCEPTION 'El stock resultante (%) es menor al reservado (%)', v_stock_posterior, v_reservado
      USING ERRCODE = 'P0003';
  END IF;

  IF v_stock_posterior = v_stock_anterior THEN
    RETURN jsonb_build_object(
      'stock', v_stock_anterior,
      'changed', false,
      'stockAnterior', v_stock_anterior,
      'stockPosterior', v_stock_anterior,
      'movimientoId', NULL
    );
  END IF;

  v_cantidad := v_stock_posterior - v_stock_anterior;

  UPDATE inventario_variantes
     SET stock = v_stock_posterior,
         updated_at = NOW()
   WHERE id = p_variante_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    v_inv_id, 'AJUSTE', v_cantidad,
    v_stock_anterior, v_stock_posterior,
    p_variante_id, 'VARIANTE',
    p_user, p_org,
    COALESCE(p_motivo, 'Ajuste manual de variante')
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'stock', v_stock_posterior,
    'changed', true,
    'stockAnterior', v_stock_anterior,
    'stockPosterior', v_stock_posterior,
    'movimientoId', v_mov_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ajustar_stock_variante_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) IS
  'Ajuste atómico de stock por variante. Lock por fila + movimiento. ERRCODE: P0002 no encontrada, P0003 stock inválido, 22023 modo inválido.';

CREATE OR REPLACE FUNCTION eliminar_variantes_y_consolidar(
  p_inv_id   TEXT,
  p_org      TEXT,
  p_user     TEXT
) RETURNS JSONB AS $$
DECLARE
  v_total_stock     INTEGER := 0;
  v_total_reserv    INTEGER := 0;
  v_count           INTEGER;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
BEGIN
  -- Lock parent
  SELECT stock INTO v_stock_anterior
  FROM inventario
  WHERE id = p_inv_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- Sumar stocks vivos
  SELECT
    COALESCE(SUM(stock), 0),
    COALESCE(SUM(stock_reservado), 0),
    COUNT(*)
  INTO v_total_stock, v_total_reserv, v_count
  FROM inventario_variantes
  WHERE inventario_id = p_inv_id
    AND deleted_at IS NULL;

  -- Desactivar flag PRIMERO para que el trigger no recalcule sobre filas borradas
  UPDATE inventario
     SET tiene_variantes = false,
         stock = v_total_stock,
         stock_reservado = v_total_reserv,
         updated_at = NOW()
   WHERE id = p_inv_id;

  v_stock_posterior := v_total_stock;

  -- Soft-delete variantes
  UPDATE inventario_variantes
     SET deleted_at = NOW(),
         activo = false,
         updated_at = NOW()
   WHERE inventario_id = p_inv_id
     AND deleted_at IS NULL;

  -- Movimiento auditable (sólo si hubo cambio efectivo)
  IF v_stock_posterior <> v_stock_anterior THEN
    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_inv_id, 'AJUSTE', v_stock_posterior - v_stock_anterior,
      v_stock_anterior, v_stock_posterior,
      p_inv_id, 'CONSOLIDACION_VARIANTES',
      p_user, p_org,
      format('Consolidación de %s variantes en stock del item', v_count)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'variantesEliminadas', v_count,
    'stockConsolidado', v_total_stock,
    'reservadoConsolidado', v_total_reserv
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_variantes_y_consolidar(TEXT, TEXT, TEXT) IS
  'Consolida variantes en el stock del parent y las soft-deletea. ERRCODE: P0002 item no encontrado.';
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: the rollback recreates the legacy table, empty', '0',
  CASE WHEN to_regclass('public.inventario_variantes') IS NULL THEN 'MISSING'
       ELSE (SELECT count(*) FROM inventario_variantes)::TEXT END;
INSERT INTO _r SELECT 81, 'rehearsal: the rollback recreates the sync function and the three RPCs', '4',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_inventario_total_variantes', 'crear_variantes_bulk',
                        'ajustar_stock_variante_atomic', 'eliminar_variantes_y_consolidar'))::TEXT;
INSERT INTO _r SELECT 82, 'rehearsal: the rollback recreates both policies and both triggers', '4',
  ((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inventario_variantes'
       AND policyname IN ('inventario_variantes_select', 'inventario_variantes_all_service'))
   + (SELECT count(*) FROM pg_trigger WHERE tgrelid = to_regclass('public.inventario_variantes') AND NOT tgisinternal
       AND tgname IN ('inventario_variantes_sync_total', 'inventario_variantes_updated_at')))::TEXT;
INSERT INTO _r SELECT 83, 'rehearsal: the VL-4 check sees the legacy sync trigger when it is back (probe 13 can fail)', '1',
  pg_temp.stock_writers()::TEXT;

-- Scratch data in the legacy state: one organization, one item carrying the flag, one legacy row.
CREATE TEMP TABLE _s (org TEXT, inv TEXT);
DO $$
DECLARE v_org TEXT; v_inv TEXT;
BEGIN
  INSERT INTO organizations (nombre, slug) VALUES ('Probe M2 Org', 'probe-m2-org') RETURNING id INTO v_org;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, tiene_variantes)
    VALUES (v_org, 'PRB-M2-1', 'Probe M2 flagged item', 'ProbeCat', 1, 1, true) RETURNING id INTO v_inv;
  INSERT INTO _s VALUES (v_org, v_inv);
END $$;
INSERT INTO inventario_variantes (inventario_id, organization_id, nombre, codigo_variante)
  SELECT inv, org, 'Probe legacy variant', 'PRB-M2-V1' FROM _s;

-- The GUARD, inline and verbatim, against a table that holds a row: it must raise 55000.
DO $outer$
BEGIN
  PERFORM pg_temp.probe(90, 'rehearsal: the guard refuses while the legacy table holds a row', '55000', $guard$
-- GUARD:BEGIN
DO $$
DECLARE
  v_rows BIGINT;
BEGIN
  IF to_regclass('public.inventario_variantes') IS NOT NULL THEN
    -- Lock first: no row can be inserted between this count and the DROP TABLE below.
    LOCK TABLE inventario_variantes IN ACCESS EXCLUSIVE MODE;

    IF EXISTS (SELECT 1 FROM inventario_variantes) THEN
      SELECT count(*) INTO v_rows FROM inventario_variantes;
      RAISE EXCEPTION 'M2 aborted: inventario_variantes still holds % row(s). Nothing was dropped.', v_rows
        USING ERRCODE = '55000',
              HINT = 'Decide what to do with those rows (migrate them to variant groups or remove them on purpose), then run M2 again.';
    END IF;
  END IF;
END $$;
-- GUARD:END
$guard$);
END $outer$;
INSERT INTO _r SELECT 91, 'rehearsal: after the refusal the legacy table is still there', 'true',
  (to_regclass('public.inventario_variantes') IS NOT NULL)::TEXT;
INSERT INTO _r SELECT 92, 'rehearsal: after the refusal the legacy row is still there', '1',
  CASE WHEN to_regclass('public.inventario_variantes') IS NULL THEN 'MISSING'
       ELSE (SELECT count(*) FROM inventario_variantes)::TEXT END;
INSERT INTO _r SELECT 93, 'rehearsal: after the refusal the sync function and the RPCs are still there', '4',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_inventario_total_variantes', 'crear_variantes_bulk',
                        'ajustar_stock_variante_atomic', 'eliminar_variantes_y_consolidar'))::TEXT;

-- Empty the table and run the migration itself, inline and verbatim.
DELETE FROM inventario_variantes WHERE codigo_variante = 'PRB-M2-V1';
-- MIGRATION:BEGIN
SET LOCAL lock_timeout = '3s';
SET LOCAL row_security = off;

-- GUARD:BEGIN
DO $$
DECLARE
  v_rows BIGINT;
BEGIN
  IF to_regclass('public.inventario_variantes') IS NOT NULL THEN
    -- Lock first: no row can be inserted between this count and the DROP TABLE below.
    LOCK TABLE inventario_variantes IN ACCESS EXCLUSIVE MODE;

    IF EXISTS (SELECT 1 FROM inventario_variantes) THEN
      SELECT count(*) INTO v_rows FROM inventario_variantes;
      RAISE EXCEPTION 'M2 aborted: inventario_variantes still holds % row(s). Nothing was dropped.', v_rows
        USING ERRCODE = '55000',
              HINT = 'Decide what to do with those rows (migrate them to variant groups or remove them on purpose), then run M2 again.';
    END IF;
  END IF;
END $$;
-- GUARD:END

-- Right after the guard and before the DROP TABLE: the exclusive locks that DROP TABLE takes on
-- `inventario` start as late as possible, so they are held for less time.
UPDATE inventario SET tiene_variantes = false WHERE tiene_variantes IS TRUE;

DROP TRIGGER IF EXISTS inventario_variantes_sync_total ON inventario_variantes;
DROP TRIGGER IF EXISTS inventario_variantes_updated_at ON inventario_variantes;

DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;

DROP FUNCTION IF EXISTS sync_inventario_total_variantes();
DROP FUNCTION IF EXISTS crear_variantes_bulk(TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS ajustar_stock_variante_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS eliminar_variantes_y_consolidar(TEXT, TEXT, TEXT);

DROP TABLE IF EXISTS inventario_variantes;

COMMENT ON COLUMN inventario.tiene_variantes IS
  'Legacy flag from migration 176, no longer read or written. It used to mark an item whose stock was the sum of inventario_variantes; that table and its sync trigger are gone (M2). Variants now live in inventario_grupos, and an item is a variant when grupo_id is set.';
-- MIGRATION:END
INSERT INTO _r SELECT 100, 'rehearsal: with 0 rows the migration removes the legacy table', 'true',
  (to_regclass('public.inventario_variantes') IS NULL)::TEXT;
INSERT INTO _r SELECT 101, 'rehearsal: with 0 rows the migration removes the sync function and the three RPCs', '0',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_inventario_total_variantes', 'crear_variantes_bulk',
                        'ajustar_stock_variante_atomic', 'eliminar_variantes_y_consolidar'))::TEXT;
INSERT INTO _r SELECT 102, 'rehearsal: after the migration no trigger writes inventario.stock', '0',
  pg_temp.stock_writers()::TEXT;
INSERT INTO _r SELECT 103, 'rehearsal: the flagged scratch item is cleared', 'false',
  COALESCE((SELECT tiene_variantes::TEXT FROM inventario WHERE id = (SELECT inv FROM _s)), 'MISSING');
INSERT INTO _r SELECT 104, 'rehearsal: the scratch item itself survives (only the flag changed)', 'PRB-M2-1',
  COALESCE((SELECT codigo FROM inventario WHERE id = (SELECT inv FROM _s)), 'MISSING');
INSERT INTO _r SELECT 105, 'rehearsal: the tiene_variantes column survives the migration', 'true',
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'inventario'
             AND column_name = 'tiene_variantes')::TEXT;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
