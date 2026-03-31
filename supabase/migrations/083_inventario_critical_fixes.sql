-- =============================================
-- 083: Inventario Critical Fixes
-- 1A. Soft-delete (deleted_at, deleted_by)
-- 1B. Per-item stock thresholds (stock_minimo, stock_maximo, punto_reorden)
-- 1C. Fix permissive RLS on cotizacion_templates
-- 1D. Full-text search + next-code performance
-- =============================================

-- ========================================
-- 1A. SOFT-DELETE
-- ========================================

ALTER TABLE inventario ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS deleted_by TEXT DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL;

-- Partial index for active items (most queries only need active)
CREATE INDEX IF NOT EXISTS idx_inventario_active ON inventario(organization_id) WHERE deleted_at IS NULL;

-- Replace unique constraint: only enforce uniqueness on active items
-- This allows re-creating a product with the same code after archiving the old one
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_organization_id_codigo_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventario_org_codigo_active_uniq
  ON inventario(organization_id, codigo) WHERE deleted_at IS NULL;

-- Update crear_venta_atomica to skip deleted items
CREATE OR REPLACE FUNCTION crear_venta_atomica(
  p_org_id TEXT,
  p_vendedor_id TEXT,
  p_cliente_id TEXT,
  p_cliente_nombre TEXT,
  p_cliente_telefono TEXT,
  p_subtotal DECIMAL,
  p_descuento DECIMAL,
  p_tipo_descuento TEXT,
  p_porcentaje_descuento DECIMAL,
  p_total DECIMAL,
  p_metodo_pago TEXT,
  p_observaciones TEXT,
  p_numero_referencia TEXT,
  p_cuotas INTEGER,
  p_recargo_porcentaje DECIMAL,
  p_monto_original DECIMAL,
  p_items JSONB,
  p_pagos JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_venta_id TEXT;
  v_numero_venta INTEGER;
  v_item JSONB;
  v_pago JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_garantia_numero TEXT;
  v_garantias JSONB := '[]'::JSONB;
  v_items_ids JSONB := '[]'::JSONB;
  v_metodo metodo_pago_venta;
  v_total_pagos DECIMAL := 0;
  v_monto_abonado DECIMAL;
  v_estado_pago TEXT;
  v_cc_result JSONB;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 1. Get next sale number atomically
  SELECT get_next_sale_number(p_org_id) INTO v_numero_venta;

  -- 2. Validate stock for ALL items with row locks (prevents race conditions)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
      FROM inventario
      WHERE id = (v_item->>'inventarioId')
        AND organization_id = p_org_id
        AND deleted_at IS NULL
      FOR UPDATE;

      IF v_inv_stock IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'descripcion';
      END IF;

      IF v_inv_stock < (v_item->>'cantidad')::INTEGER THEN
        RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %', v_inv_nombre, v_inv_stock;
      END IF;
    END IF;
  END LOOP;

  -- 3. Determine monto_abonado and estado_pago
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    SELECT COALESCE(SUM((p->>'monto')::DECIMAL), 0) INTO v_total_pagos
    FROM jsonb_array_elements(p_pagos) AS p;
    v_monto_abonado := v_total_pagos;
  ELSIF p_pagos IS NOT NULL THEN
    v_monto_abonado := 0;
  ELSE
    v_monto_abonado := p_total;
  END IF;

  IF v_monto_abonado >= p_total THEN
    v_estado_pago := 'PAGADO';
  ELSIF v_monto_abonado > 0 THEN
    v_estado_pago := 'PAGADO_PARCIAL';
  ELSE
    v_estado_pago := 'PENDIENTE';
  END IF;

  -- 4. Create the sale
  INSERT INTO ventas (
    numero_venta, cliente_id, cliente_nombre, cliente_telefono,
    vendedor_id, subtotal, descuento, tipo_descuento, porcentaje_descuento,
    total, metodo_pago, monto_abonado, estado_pago, observaciones, organization_id
  ) VALUES (
    v_numero_venta,
    NULLIF(p_cliente_id, ''),
    p_cliente_nombre,
    NULLIF(p_cliente_telefono, ''),
    p_vendedor_id,
    p_subtotal,
    p_descuento,
    COALESCE(p_tipo_descuento, 'MONTO'),
    COALESCE(p_porcentaje_descuento, 0),
    p_total,
    v_metodo,
    v_monto_abonado,
    v_estado_pago,
    NULLIF(p_observaciones, ''),
    p_org_id
  ) RETURNING id INTO v_venta_id;

  -- 5. Create payment records
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
    LOOP
      IF (v_pago->>'metodo') = 'CUENTA_CORRIENTE' AND p_cliente_id IS NOT NULL AND p_cliente_id != '' THEN
        SELECT usar_cuenta_corriente(
          p_org_id,
          p_cliente_id,
          (v_pago->>'monto')::DECIMAL,
          'VENTA',
          v_venta_id,
          p_vendedor_id
        ) INTO v_cc_result;
      END IF;

      INSERT INTO pagos_venta (venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original)
      VALUES (
        v_venta_id,
        (v_pago->>'monto')::DECIMAL,
        (v_pago->>'metodo')::metodo_pago_venta,
        NULLIF(v_pago->>'referencia', ''),
        (v_pago->>'cuotas')::INTEGER,
        (v_pago->>'recargo')::DECIMAL,
        (v_pago->>'montoOriginal')::DECIMAL
      );
    END LOOP;
  ELSIF p_pagos IS NULL THEN
    INSERT INTO pagos_venta (venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original)
    VALUES (
      v_venta_id,
      p_total,
      v_metodo,
      NULLIF(p_numero_referencia, ''),
      p_cuotas,
      p_recargo_porcentaje,
      p_monto_original
    );
  END IF;

  -- 6. Insert items, deduct stock, create movements, create warranties
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento
    ) VALUES (
      v_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0)
    ) RETURNING id INTO v_item_id;

    v_items_ids := v_items_ids || to_jsonb(v_item_id);

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id
      )
      SELECT
        (v_item->>'inventarioId'),
        'VENTA',
        -(v_item->>'cantidad')::INTEGER,
        stock,
        stock - (v_item->>'cantidad')::INTEGER,
        v_venta_id,
        'VENTA',
        p_vendedor_id,
        p_org_id
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario
      SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId');
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        v_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        NOW(),
        NOW() + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ventaId', v_venta_id,
    'numeroVenta', v_numero_venta,
    'garantias', v_garantias,
    'items', v_items_ids
  );
END;
$$ LANGUAGE plpgsql;

-- Update editar_venta_atomica to skip deleted items
CREATE OR REPLACE FUNCTION editar_venta_atomica(
  p_org_id TEXT,
  p_user_id TEXT,
  p_venta_id TEXT,
  p_cliente_id TEXT,
  p_cliente_nombre TEXT,
  p_cliente_telefono TEXT,
  p_subtotal DECIMAL,
  p_descuento DECIMAL,
  p_tipo_descuento TEXT,
  p_porcentaje_descuento DECIMAL,
  p_total DECIMAL,
  p_metodo_pago TEXT,
  p_observaciones TEXT,
  p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_old_item RECORD;
  v_item JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_garantia_numero TEXT;
  v_metodo metodo_pago_venta;
  v_garantias JSONB := '[]'::JSONB;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 1. Restore stock for old items + record ANULACION movements
  FOR v_old_item IN
    SELECT iv.inventario_id, iv.cantidad, i.stock, i.nombre
    FROM items_venta iv
    LEFT JOIN inventario i ON i.id = iv.inventario_id
    WHERE iv.venta_id = p_venta_id AND iv.inventario_id IS NOT NULL
  LOOP
    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
    ) VALUES (
      v_old_item.inventario_id, 'ANULACION', v_old_item.cantidad,
      v_old_item.stock, v_old_item.stock + v_old_item.cantidad,
      p_venta_id, 'EDICION_VENTA', p_user_id, p_org_id,
      'Restauración por edición de venta'
    );

    UPDATE inventario SET stock = stock + v_old_item.cantidad
    WHERE id = v_old_item.inventario_id;
  END LOOP;

  -- 2. Delete old items and warranties
  DELETE FROM garantias_venta WHERE venta_id = p_venta_id;
  DELETE FROM items_venta WHERE venta_id = p_venta_id;

  -- 3. Update sale header
  UPDATE ventas SET
    cliente_id = NULLIF(p_cliente_id, ''),
    cliente_nombre = p_cliente_nombre,
    cliente_telefono = NULLIF(p_cliente_telefono, ''),
    subtotal = p_subtotal,
    descuento = p_descuento,
    tipo_descuento = COALESCE(p_tipo_descuento, 'MONTO'),
    porcentaje_descuento = COALESCE(p_porcentaje_descuento, 0),
    total = p_total,
    metodo_pago = v_metodo,
    observaciones = NULLIF(p_observaciones, ''),
    updated_at = NOW()
  WHERE id = p_venta_id AND organization_id = p_org_id;

  -- 4. Validate stock for new items with row locks (skip deleted items)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
      FROM inventario
      WHERE id = (v_item->>'inventarioId')
        AND organization_id = p_org_id
        AND deleted_at IS NULL
      FOR UPDATE;

      IF v_inv_stock IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'descripcion';
      END IF;

      IF v_inv_stock < (v_item->>'cantidad')::INTEGER THEN
        RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %', v_inv_nombre, v_inv_stock;
      END IF;
    END IF;
  END LOOP;

  -- 5. Insert new items, deduct stock, record VENTA movements, create warranties
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento
    ) VALUES (
      p_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0)
    ) RETURNING id INTO v_item_id;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id
      )
      SELECT
        (v_item->>'inventarioId'), 'VENTA', -(v_item->>'cantidad')::INTEGER,
        stock, stock - (v_item->>'cantidad')::INTEGER,
        p_venta_id, 'VENTA', p_user_id, p_org_id
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId');
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        p_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        NOW(), NOW() + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'garantias', v_garantias);
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 1B. PER-ITEM STOCK THRESHOLDS
-- ========================================

ALTER TABLE inventario ADD COLUMN IF NOT EXISTS stock_minimo INTEGER DEFAULT NULL;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS stock_maximo INTEGER DEFAULT NULL;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS punto_reorden INTEGER DEFAULT NULL;

ALTER TABLE inventario ADD CONSTRAINT chk_inventario_stock_minimo
  CHECK (stock_minimo IS NULL OR stock_minimo >= 0);
ALTER TABLE inventario ADD CONSTRAINT chk_inventario_stock_maximo
  CHECK (stock_maximo IS NULL OR (stock_minimo IS NULL OR stock_maximo >= stock_minimo));
ALTER TABLE inventario ADD CONSTRAINT chk_inventario_punto_reorden
  CHECK (punto_reorden IS NULL OR punto_reorden >= 0);

-- ========================================
-- 1C. FIX PERMISSIVE RLS ON TEMPLATES
-- ========================================

DROP POLICY IF EXISTS "cotizacion_templates_org_read" ON cotizacion_templates;
DROP POLICY IF EXISTS "cotizacion_templates_org_write" ON cotizacion_templates;
DROP POLICY IF EXISTS "items_template_cotizacion_read" ON items_template_cotizacion;
DROP POLICY IF EXISTS "items_template_cotizacion_write" ON items_template_cotizacion;

CREATE POLICY "cotizacion_templates_org_isolation" ON cotizacion_templates
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

CREATE POLICY "items_template_cotizacion_via_template" ON items_template_cotizacion
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cotizacion_templates ct
            WHERE ct.id = items_template_cotizacion.template_id
            AND ct.organization_id = current_setting('app.organization_id', true))
  );

-- ========================================
-- 1D. FULL-TEXT SEARCH FOR INVENTARIO
-- ========================================

ALTER TABLE inventario ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION inventario_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.nombre, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.codigo, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.descripcion, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.categoria, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.proveedor, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventario_search_update ON inventario;
CREATE TRIGGER inventario_search_update
  BEFORE INSERT OR UPDATE ON inventario
  FOR EACH ROW EXECUTE FUNCTION inventario_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_inventario_search ON inventario USING gin(search_vector);

-- Backfill existing records
UPDATE inventario SET search_vector =
  setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(codigo, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(descripcion, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(categoria, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(proveedor, '')), 'C');

-- ========================================
-- 1D. OPTIMIZED NEXT-CODE FUNCTION
-- ========================================

-- Index for prefix lookups on codes
CREATE INDEX IF NOT EXISTS idx_inventario_codigo_prefix
  ON inventario(organization_id, codigo text_pattern_ops) WHERE deleted_at IS NULL;

-- SQL function replaces JS-side scan of all codes
CREATE OR REPLACE FUNCTION get_next_inventory_code(p_org_id TEXT, p_prefix TEXT)
RETURNS TEXT AS $$
DECLARE
  v_max_num INTEGER := 0;
BEGIN
  SELECT MAX(
    CAST(SUBSTRING(codigo FROM LENGTH(p_prefix) + 1) AS INTEGER)
  ) INTO v_max_num
  FROM inventario
  WHERE organization_id = p_org_id
    AND codigo LIKE p_prefix || '%'
    AND deleted_at IS NULL
    AND SUBSTRING(codigo FROM LENGTH(p_prefix) + 1) ~ '^\d+$';

  v_max_num := COALESCE(v_max_num, 0) + 1;
  RETURN p_prefix || LPAD(v_max_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;
