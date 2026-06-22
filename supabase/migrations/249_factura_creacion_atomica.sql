-- Migration 249: Atomic factura creation RPC + pagos_parciales monto > 0 constraint.
-- Fixes F4: factura insert + items_factura insert + seña pagos_parciales insert were three
-- separate statements; an items failure left the factura without items (silent inconsistency).
-- Applied manually in Supabase SQL editor.

-- ============================================================
-- (1) Safeguard: fail loudly if any existing pagos_parciales row has monto <= 0
--     before adding the CHECK constraint so the migration errors early instead
--     of at a later ambiguous stage.
-- ============================================================
DO $$
DECLARE
  v_bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_bad_count FROM pagos_parciales WHERE monto <= 0;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'Migration 249 aborted: % pagos_parciales row(s) have monto <= 0. '
      'Fix the data before applying this migration.', v_bad_count;
  END IF;
END;
$$;

-- ============================================================
-- (2) Add CHECK constraint pagos_parciales.monto > 0 (idempotent)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pagos_parciales_monto_positivo'
      AND conrelid = 'pagos_parciales'::regclass
  ) THEN
    ALTER TABLE pagos_parciales
      ADD CONSTRAINT pagos_parciales_monto_positivo CHECK (monto > 0);
  END IF;
END;
$$;

-- ============================================================
-- (3) Atomic factura creation RPC
-- ============================================================
CREATE OR REPLACE FUNCTION crear_factura_atomica(
  p_orden_id        TEXT,
  p_numero_factura  TEXT,
  p_subtotal        DECIMAL,
  p_iva             DECIMAL,
  p_total           DECIMAL,
  p_monto_abonado   DECIMAL,
  p_estado_pago     TEXT,
  p_cotizacion_id   TEXT,
  p_items           JSONB,
  p_sena_monto      DECIMAL DEFAULT 0,
  p_sena_metodo     TEXT    DEFAULT 'EFECTIVO'
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_factura_id  TEXT;
  v_item        JSONB;
BEGIN
  -- 1. Insert factura
  INSERT INTO facturas (
    orden_id,
    numero_factura,
    subtotal,
    iva,
    total,
    monto_abonado,
    estado_pago,
    cotizacion_id
  ) VALUES (
    p_orden_id,
    p_numero_factura,
    p_subtotal,
    p_iva,
    p_total,
    p_monto_abonado,
    p_estado_pago::estado_pago,
    NULLIF(p_cotizacion_id, '')
  )
  RETURNING id INTO v_factura_id;

  -- 2. Insert items if any
  IF jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO items_factura (
        factura_id,
        cotizacion_item_id,
        descripcion,
        cantidad,
        precio_unitario,
        subtotal,
        tipo
      ) VALUES (
        v_factura_id,
        NULLIF((v_item->>'cotizacion_item_id')::TEXT, ''),
        (v_item->>'descripcion')::TEXT,
        (v_item->>'cantidad')::INTEGER,
        (v_item->>'precio_unitario')::NUMERIC,
        (v_item->>'subtotal')::NUMERIC,
        (v_item->>'tipo')::TEXT
      );
    END LOOP;
  END IF;

  -- 3. Insert seña as pagos_parciales if monto > 0
  IF p_sena_monto > 0 THEN
    INSERT INTO pagos_parciales (
      factura_id,
      monto,
      metodo_pago,
      observaciones
    ) VALUES (
      v_factura_id,
      p_sena_monto,
      p_sena_metodo::metodo_pago,
      'Seña abonada al momento del ingreso'
    );
  END IF;

  RETURN jsonb_build_object('id', v_factura_id);
END;
$$;

COMMENT ON FUNCTION crear_factura_atomica(TEXT, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, JSONB, DECIMAL, TEXT) IS
  'Atomically creates a factura with its items_factura rows and optional seña pagos_parciales row. '
  'All three inserts run in a single transaction so a partial failure cannot leave an '
  'orphaned factura without items. estado_pago and metodo_pago are cast to their '
  'respective enum types. Migration 249.';
