-- =============================================
-- 109: Órdenes de Compra + Barcode
-- 4.1 Tabla ordenes_compra + items_orden_compra
-- 4.5 Barcode en inventario
-- =============================================

-- ========================================
-- 4.1 ÓRDENES DE COMPRA
-- ========================================

CREATE TABLE IF NOT EXISTS ordenes_compra (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  proveedor_id TEXT REFERENCES proveedores(id) ON DELETE SET NULL,
  numero_oc TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR','ENVIADA','RECIBIDA_PARCIAL','RECIBIDA','CANCELADA')),
  fecha_emision TIMESTAMPTZ DEFAULT NOW(),
  fecha_recepcion_esperada DATE,
  fecha_recepcion_real TIMESTAMPTZ,
  subtotal DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) DEFAULT 0,
  notas TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, numero_oc)
);

CREATE TABLE IF NOT EXISTS items_orden_compra (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_compra_id TEXT NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  inventario_id TEXT NOT NULL REFERENCES inventario(id),
  cantidad_pedida INTEGER NOT NULL CHECK (cantidad_pedida > 0),
  cantidad_recibida INTEGER DEFAULT 0,
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_org ON ordenes_compra(organization_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON ordenes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_items_orden_compra_oc ON items_orden_compra(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_items_orden_compra_inv ON items_orden_compra(inventario_id);

-- RLS
ALTER TABLE ordenes_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_orden_compra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ordenes_compra_org_isolation" ON ordenes_compra
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

CREATE POLICY "items_orden_compra_via_oc" ON items_orden_compra
  FOR ALL USING (
    EXISTS (SELECT 1 FROM ordenes_compra oc
            WHERE oc.id = items_orden_compra.orden_compra_id
            AND oc.organization_id = current_setting('app.organization_id', true))
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION ordenes_compra_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ordenes_compra_set_updated_at ON ordenes_compra;
CREATE TRIGGER ordenes_compra_set_updated_at
  BEFORE UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION ordenes_compra_updated_at();

-- Counter function for OC numbers
CREATE OR REPLACE FUNCTION get_next_oc_number(p_org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_max INTEGER := 0;
BEGIN
  SELECT MAX(CAST(SUBSTRING(numero_oc FROM 4) AS INTEGER)) INTO v_max
  FROM ordenes_compra
  WHERE organization_id = p_org_id
    AND numero_oc ~ '^OC-\d+$';

  v_max := COALESCE(v_max, 0) + 1;
  RETURN 'OC-' || LPAD(v_max::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 4.1b RPC RECIBIR ORDEN DE COMPRA
-- ========================================

CREATE OR REPLACE FUNCTION recibir_orden_compra(
  p_oc_id TEXT,
  p_user_id TEXT,
  p_items JSONB  -- [{itemId, cantidadRecibida}]
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_ioc RECORD;
  v_inv_stock INTEGER;
  v_org_id TEXT;
  v_total_pedida INTEGER := 0;
  v_total_recibida INTEGER := 0;
  v_nuevo_estado TEXT;
  v_count INTEGER := 0;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes_compra WHERE id = p_oc_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  -- Process each received item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT ioc.*, i.stock, i.precio_compra AS inv_precio_compra
    INTO v_ioc
    FROM items_orden_compra ioc
    JOIN inventario i ON i.id = ioc.inventario_id
    WHERE ioc.id = (v_item->>'itemId')
      AND ioc.orden_compra_id = p_oc_id
    FOR UPDATE OF i;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Update received quantity
    UPDATE items_orden_compra
    SET cantidad_recibida = cantidad_recibida + (v_item->>'cantidadRecibida')::INTEGER
    WHERE id = (v_item->>'itemId');

    -- Increment inventory stock
    UPDATE inventario
    SET stock = stock + (v_item->>'cantidadRecibida')::INTEGER
    WHERE id = v_ioc.inventario_id;

    -- Record movement
    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
    ) VALUES (
      v_ioc.inventario_id, 'COMPRA_RECIBIDA', (v_item->>'cantidadRecibida')::INTEGER,
      v_ioc.stock, v_ioc.stock + (v_item->>'cantidadRecibida')::INTEGER,
      p_oc_id, 'ORDEN_COMPRA', p_user_id, v_org_id,
      'Recepción de orden de compra'
    );

    v_count := v_count + 1;
  END LOOP;

  -- Calculate new state
  SELECT
    SUM(cantidad_pedida), SUM(cantidad_recibida)
  INTO v_total_pedida, v_total_recibida
  FROM items_orden_compra
  WHERE orden_compra_id = p_oc_id;

  IF v_total_recibida >= v_total_pedida THEN
    v_nuevo_estado := 'RECIBIDA';
  ELSIF v_total_recibida > 0 THEN
    v_nuevo_estado := 'RECIBIDA_PARCIAL';
  ELSE
    v_nuevo_estado := 'ENVIADA';
  END IF;

  UPDATE ordenes_compra
  SET estado = v_nuevo_estado,
      fecha_recepcion_real = CASE WHEN v_nuevo_estado = 'RECIBIDA' THEN NOW() ELSE fecha_recepcion_real END
  WHERE id = p_oc_id;

  RETURN jsonb_build_object(
    'success', true,
    'itemsRecibidos', v_count,
    'nuevoEstado', v_nuevo_estado
  );
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 4.5 BARCODE EN INVENTARIO
-- ========================================

ALTER TABLE inventario ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS inventario_barcode_idx
  ON inventario(organization_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
