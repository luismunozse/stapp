-- Migration 250: enforce unique numero_factura per organization on facturas.
-- Applied manually in Supabase SQL editor.

-- ============================================================
-- (1) Add organization_id column (idempotent)
-- ============================================================
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- ============================================================
-- (2) Add FK to organizations (idempotent via pg_constraint check)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facturas_organization_id_fkey'
      AND conrelid = 'facturas'::regclass
  ) THEN
    ALTER TABLE facturas
      ADD CONSTRAINT facturas_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE;
  END IF;
END;
$$;

-- ============================================================
-- (3) Backfill: derive organization_id from ordenes_servicio
-- ============================================================
UPDATE facturas f
SET organization_id = o.organization_id
FROM ordenes_servicio o
WHERE o.id = f.orden_id
  AND f.organization_id IS NULL;

-- ============================================================
-- (4) Guard: fail loudly before making the column NOT NULL
--     Check A: any row still NULL after backfill (orphan facturas)
--     Check B: any (organization_id, numero_factura) duplicate
-- ============================================================
DO $$
DECLARE
  v_null_count    INTEGER;
  v_dup_count     INTEGER;
BEGIN
  -- Check A: orphans
  SELECT COUNT(*) INTO v_null_count
  FROM facturas
  WHERE organization_id IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION
      'Migration 250 aborted: % factura(s) still have organization_id IS NULL after backfill. '
      'These rows have no matching ordenes_servicio. Fix the data (delete orphans or set '
      'organization_id manually) before retrying this migration.', v_null_count;
  END IF;

  -- Check B: duplicates
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT organization_id, numero_factura
    FROM facturas
    GROUP BY organization_id, numero_factura
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration 250 aborted: % duplicate (organization_id, numero_factura) pair(s) found. '
      'Resolve the duplicate invoice numbers before adding the unique constraint. '
      'Query: SELECT organization_id, numero_factura, COUNT(*) FROM facturas '
      'GROUP BY organization_id, numero_factura HAVING COUNT(*) > 1;', v_dup_count;
  END IF;
END;
$$;

-- ============================================================
-- (5) Make organization_id NOT NULL
-- ============================================================
ALTER TABLE facturas
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- (6) Unique index on (organization_id, numero_factura)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS facturas_org_numero_uniq
  ON facturas(organization_id, numero_factura);

-- ============================================================
-- (7) Recreate crear_factura_atomica — identical to migration 249
--     but sets organization_id on the factura INSERT, derived
--     from the orden (no new parameter added to signature).
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
  v_org_id      TEXT;
  v_item        JSONB;
BEGIN
  -- Derive organization_id from the orden (no caller change needed)
  SELECT organization_id INTO v_org_id
  FROM ordenes_servicio
  WHERE id = p_orden_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada: %', p_orden_id;
  END IF;

  -- 1. Insert factura (now includes organization_id)
  INSERT INTO facturas (
    orden_id,
    organization_id,
    numero_factura,
    subtotal,
    iva,
    total,
    monto_abonado,
    estado_pago,
    cotizacion_id
  ) VALUES (
    p_orden_id,
    v_org_id,
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
  'Derives organization_id from ordenes_servicio (no caller change). '
  'All inserts run in a single transaction so a partial failure cannot leave an '
  'orphaned factura without items. estado_pago and metodo_pago are cast to their '
  'respective enum types. Migration 250.';
