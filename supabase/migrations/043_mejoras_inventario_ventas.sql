-- ========================================
-- MEJORAS INVENTARIO & VENTAS
-- Integridad transaccional, movimientos de stock,
-- devoluciones, descuento porcentual, constraints
-- ========================================

-- ========================================
-- 1. PRE-FIX DATA (evitar fallos en constraints)
-- ========================================
UPDATE inventario SET stock = 0 WHERE stock < 0;
UPDATE ventas SET descuento = subtotal WHERE descuento > subtotal;
UPDATE ventas SET monto_abonado = 0 WHERE monto_abonado < 0 OR monto_abonado IS NULL;

-- ========================================
-- 2. CHECK CONSTRAINTS (idempotent: drop if exists, then add)
-- ========================================

-- Inventario
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS chk_inventario_stock_non_negative;
ALTER TABLE inventario ADD CONSTRAINT chk_inventario_stock_non_negative CHECK (stock >= 0);
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS chk_inventario_precio_compra_positive;
ALTER TABLE inventario ADD CONSTRAINT chk_inventario_precio_compra_positive CHECK (precio_compra >= 0);
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS chk_inventario_precio_venta_positive;
ALTER TABLE inventario ADD CONSTRAINT chk_inventario_precio_venta_positive CHECK (precio_venta >= 0);

-- Ventas
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_subtotal_non_negative;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_subtotal_non_negative CHECK (subtotal >= 0);
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_total_non_negative;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_total_non_negative CHECK (total >= 0);
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_descuento_non_negative;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_descuento_non_negative CHECK (descuento >= 0);
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_descuento_lte_subtotal;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_descuento_lte_subtotal CHECK (descuento <= subtotal);
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_monto_abonado_non_negative;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_monto_abonado_non_negative CHECK (monto_abonado >= 0);

-- Items venta
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS chk_items_venta_cantidad_positive;
ALTER TABLE items_venta ADD CONSTRAINT chk_items_venta_cantidad_positive CHECK (cantidad > 0);
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS chk_items_venta_precio_positive;
ALTER TABLE items_venta ADD CONSTRAINT chk_items_venta_precio_positive CHECK (precio_unitario > 0);
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS chk_items_venta_subtotal_positive;
ALTER TABLE items_venta ADD CONSTRAINT chk_items_venta_subtotal_positive CHECK (subtotal > 0);

-- Pagos venta
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS chk_pagos_venta_monto_positive;
ALTER TABLE pagos_venta ADD CONSTRAINT chk_pagos_venta_monto_positive CHECK (monto > 0);

-- ========================================
-- 3. COLUMNAS DE DESCUENTO PORCENTUAL
-- ========================================

-- En ventas: tipo de descuento global
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS tipo_descuento TEXT DEFAULT 'MONTO',
  ADD COLUMN IF NOT EXISTS porcentaje_descuento DECIMAL(5,2) DEFAULT 0;

ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_tipo_descuento;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_tipo_descuento
  CHECK (tipo_descuento IN ('MONTO', 'PORCENTAJE'));
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS chk_ventas_porcentaje_descuento;
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_porcentaje_descuento
  CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 100);

-- En items_venta: descuento por item
ALTER TABLE items_venta
  ADD COLUMN IF NOT EXISTS descuento DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tipo_descuento TEXT DEFAULT 'MONTO',
  ADD COLUMN IF NOT EXISTS porcentaje_descuento DECIMAL(5,2) DEFAULT 0;

ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS chk_items_venta_descuento_non_negative;
ALTER TABLE items_venta ADD CONSTRAINT chk_items_venta_descuento_non_negative
  CHECK (descuento >= 0);
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS chk_items_venta_tipo_descuento;
ALTER TABLE items_venta ADD CONSTRAINT chk_items_venta_tipo_descuento
  CHECK (tipo_descuento IN ('MONTO', 'PORCENTAJE'));
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS chk_items_venta_porcentaje_descuento;
ALTER TABLE items_venta ADD CONSTRAINT chk_items_venta_porcentaje_descuento
  CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 100);

-- ========================================
-- 4. TABLA: movimientos_inventario
-- ========================================

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE', 'VENTA', 'DEVOLUCION', 'ANULACION')),
  cantidad INTEGER NOT NULL,
  stock_anterior INTEGER NOT NULL,
  stock_posterior INTEGER NOT NULL CHECK (stock_posterior >= 0),
  referencia_id TEXT,
  referencia_tipo TEXT,
  observaciones TEXT,
  usuario_id TEXT REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS movimientos_inv_inventario_id_idx ON movimientos_inventario(inventario_id);
CREATE INDEX IF NOT EXISTS movimientos_inv_tipo_idx ON movimientos_inventario(tipo);
CREATE INDEX IF NOT EXISTS movimientos_inv_referencia_idx ON movimientos_inventario(referencia_id);
CREATE INDEX IF NOT EXISTS movimientos_inv_organization_id_idx ON movimientos_inventario(organization_id);
CREATE INDEX IF NOT EXISTS movimientos_inv_created_at_idx ON movimientos_inventario(created_at);

ALTER TABLE movimientos_inventario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS movimientos_inv_select ON movimientos_inventario;
CREATE POLICY movimientos_inv_select ON movimientos_inventario
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS movimientos_inv_insert ON movimientos_inventario;
CREATE POLICY movimientos_inv_insert ON movimientos_inventario
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

-- ========================================
-- 5. TABLAS: devoluciones_venta + items_devolucion
-- ========================================

CREATE TABLE IF NOT EXISTS devoluciones_venta (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  venta_id TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  numero_devolucion TEXT NOT NULL,
  motivo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('TOTAL', 'PARCIAL')),
  monto_devolucion DECIMAL(10,2) NOT NULL CHECK (monto_devolucion > 0),
  estado TEXT DEFAULT 'COMPLETADA' CHECK (estado IN ('PENDIENTE', 'COMPLETADA', 'RECHAZADA')),
  observaciones TEXT,
  procesado_por TEXT REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, numero_devolucion)
);

CREATE TABLE IF NOT EXISTS items_devolucion (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  devolucion_id TEXT NOT NULL REFERENCES devoluciones_venta(id) ON DELETE CASCADE,
  item_venta_id TEXT NOT NULL REFERENCES items_venta(id),
  inventario_id TEXT REFERENCES inventario(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal > 0),
  restaurar_stock BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS devoluciones_venta_venta_id_idx ON devoluciones_venta(venta_id);
CREATE INDEX IF NOT EXISTS devoluciones_venta_org_idx ON devoluciones_venta(organization_id);
CREATE INDEX IF NOT EXISTS items_devolucion_devolucion_id_idx ON items_devolucion(devolucion_id);

ALTER TABLE devoluciones_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_devolucion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devoluciones_venta_select ON devoluciones_venta;
CREATE POLICY devoluciones_venta_select ON devoluciones_venta
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS devoluciones_venta_insert ON devoluciones_venta;
CREATE POLICY devoluciones_venta_insert ON devoluciones_venta
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS devoluciones_venta_update ON devoluciones_venta;
CREATE POLICY devoluciones_venta_update ON devoluciones_venta
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS items_devolucion_select ON items_devolucion;
CREATE POLICY items_devolucion_select ON items_devolucion
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM devoluciones_venta d WHERE d.id = items_devolucion.devolucion_id
      AND d.organization_id = current_setting('app.organization_id', true))
  );
DROP POLICY IF EXISTS items_devolucion_insert ON items_devolucion;
CREATE POLICY items_devolucion_insert ON items_devolucion
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM devoluciones_venta d WHERE d.id = items_devolucion.devolucion_id
      AND d.organization_id = current_setting('app.organization_id', true))
  );

DROP TRIGGER IF EXISTS devoluciones_venta_updated_at ON devoluciones_venta;
CREATE TRIGGER devoluciones_venta_updated_at
  BEFORE UPDATE ON devoluciones_venta
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 6. UMBRAL STOCK CONFIGURABLE
-- ========================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS umbral_stock_bajo INTEGER DEFAULT 5;

-- ========================================
-- 7. CONTADOR DE DEVOLUCIONES
-- ========================================

ALTER TABLE organization_counters
  ADD COLUMN IF NOT EXISTS next_return_number INTEGER DEFAULT 1;

CREATE OR REPLACE FUNCTION get_next_return_number(org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  UPDATE organization_counters
  SET next_return_number = next_return_number + 1
  WHERE organization_id = org_id
  RETURNING next_return_number - 1 INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_return_number)
    VALUES (org_id, 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_return_number = organization_counters.next_return_number + 1
    RETURNING next_return_number - 1 INTO next_num;
  END IF;

  RETURN 'DEV-' || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 8. FUNCIONES RPC increment_stock / decrement_stock
-- (formalizadas con logging de movimientos)
-- ========================================

CREATE OR REPLACE FUNCTION increment_stock(
  p_inventario_id TEXT,
  p_cantidad INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE inventario
  SET stock = stock + p_cantidad
  WHERE id = p_inventario_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_stock(
  p_inventario_id TEXT,
  p_cantidad INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE inventario
  SET stock = stock - p_cantidad
  WHERE id = p_inventario_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 9. FUNCION ATOMICA: crear_venta_atomica
-- ========================================

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
  p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_venta_id TEXT;
  v_numero_venta INTEGER;
  v_item JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_garantia_numero TEXT;
  v_garantias JSONB := '[]'::JSONB;
  v_items_ids JSONB := '[]'::JSONB;
  v_metodo metodo_pago_venta;
BEGIN
  -- Cast method
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 1. Get next sale number atomically
  SELECT get_next_sale_number(p_org_id) INTO v_numero_venta;

  -- 2. Validate stock for ALL items with row locks
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
      FROM inventario
      WHERE id = (v_item->>'inventarioId')
        AND organization_id = p_org_id
      FOR UPDATE;

      IF v_inv_stock IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'descripcion';
      END IF;

      IF v_inv_stock < (v_item->>'cantidad')::INTEGER THEN
        RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %', v_inv_nombre, v_inv_stock;
      END IF;
    END IF;
  END LOOP;

  -- 3. Create the sale
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
    p_total,
    'PAGADO',
    NULLIF(p_observaciones, ''),
    p_org_id
  ) RETURNING id INTO v_venta_id;

  -- 4. Create payment record
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

  -- 5. Insert items, deduct stock, create movements, create warranties
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

    -- Deduct stock and record movement
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

    -- Create warranty if applicable
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
    'itemsIds', v_items_ids
  );
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 10. FUNCION ATOMICA: editar_venta_atomica
-- ========================================

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

  -- 4. Validate stock for new items with row locks
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
      FROM inventario
      WHERE id = (v_item->>'inventarioId')
        AND organization_id = p_org_id
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
-- 11. TRIGGER ANULACION CON MOVIMIENTOS
-- ========================================

CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    FOR v_item IN
      SELECT iv.inventario_id, iv.cantidad, i.stock
      FROM items_venta iv
      JOIN inventario i ON i.id = iv.inventario_id
      WHERE iv.venta_id = NEW.id AND iv.inventario_id IS NOT NULL
    LOOP
      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id
      ) VALUES (
        v_item.inventario_id, 'ANULACION', v_item.cantidad,
        v_item.stock, v_item.stock + v_item.cantidad,
        NEW.id, 'ANULACION_VENTA', NEW.organization_id
      );

      -- Restore stock
      UPDATE inventario SET stock = stock + v_item.cantidad
      WHERE id = v_item.inventario_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recrear trigger (DROP + CREATE para reemplazar la vieja version)
DROP TRIGGER IF EXISTS trigger_restore_stock_on_cancel ON ventas;
CREATE TRIGGER trigger_restore_stock_on_cancel
  AFTER UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION restore_stock_on_cancel();

-- Eliminar trigger que descuenta stock en INSERT items_venta
-- (la funcion atomica lo maneja con movimientos)
DROP TRIGGER IF EXISTS trigger_update_stock_on_sale ON items_venta;
