-- ============================================
-- CUENTA CORRIENTE DE CLIENTES (Saldo a favor)
-- Permite a los clientes ir dejando dinero a cuenta
-- ============================================

CREATE TABLE IF NOT EXISTS cuenta_corriente (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('DEPOSITO', 'USO', 'DEVOLUCION', 'AJUSTE')),
  monto DECIMAL(10,2) NOT NULL, -- positivo para depósitos, negativo para usos
  saldo_posterior DECIMAL(10,2) NOT NULL, -- saldo después de este movimiento
  metodo_pago TEXT, -- método usado para el depósito (EFECTIVO, TRANSFERENCIA, etc.)
  referencia_tipo TEXT, -- 'VENTA', 'FACTURA', 'MANUAL'
  referencia_id TEXT, -- ID de la venta o factura asociada
  numero_referencia TEXT, -- nro. transferencia/operación
  observaciones TEXT,
  usuario_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cuenta_corriente_cliente ON cuenta_corriente(organization_id, cliente_id, created_at DESC);
CREATE INDEX idx_cuenta_corriente_org ON cuenta_corriente(organization_id);

-- Saldo actual del cliente (vista materializada como columna en clientes)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_cuenta DECIMAL(10,2) NOT NULL DEFAULT 0;

-- RLS
ALTER TABLE cuenta_corriente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_cuenta_corriente" ON cuenta_corriente
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "service_role_cuenta_corriente" ON cuenta_corriente
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- Agregar CUENTA_CORRIENTE como método de pago
-- ============================================
ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'CUENTA_CORRIENTE';
ALTER TYPE metodo_pago_venta ADD VALUE IF NOT EXISTS 'CUENTA_CORRIENTE';

-- ============================================
-- Función para registrar depósito a cuenta
-- ============================================
CREATE OR REPLACE FUNCTION depositar_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_metodo_pago TEXT,
  p_numero_referencia TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_usuario_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  -- Obtener saldo actual con lock
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := v_saldo_actual + p_monto;

  -- Crear movimiento
  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    metodo_pago, referencia_tipo, numero_referencia, observaciones, usuario_id
  ) VALUES (
    p_org_id, p_cliente_id, 'DEPOSITO', p_monto, v_nuevo_saldo,
    p_metodo_pago, 'MANUAL', p_numero_referencia, p_observaciones, p_usuario_id
  ) RETURNING id INTO v_mov_id;

  -- Actualizar saldo en clientes
  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'saldoAnterior', v_saldo_actual,
    'saldoNuevo', v_nuevo_saldo
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Función para usar saldo de cuenta corriente
-- ============================================
CREATE OR REPLACE FUNCTION usar_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  -- Obtener saldo actual con lock
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  IF v_saldo_actual < p_monto THEN
    RAISE EXCEPTION 'Saldo insuficiente. Disponible: %', v_saldo_actual;
  END IF;

  v_nuevo_saldo := v_saldo_actual - p_monto;

  -- Crear movimiento (monto negativo)
  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id
  ) VALUES (
    p_org_id, p_cliente_id, 'USO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id
  ) RETURNING id INTO v_mov_id;

  -- Actualizar saldo en clientes
  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'saldoAnterior', v_saldo_actual,
    'saldoNuevo', v_nuevo_saldo
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Actualizar crear_venta_atomica para pagos múltiples
-- ============================================
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
  p_pagos JSONB DEFAULT NULL  -- nuevo: array de pagos [{metodo, monto, referencia, cuotas, recargo}]
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
  -- Cast method (del método principal, para backwards compat)
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

  -- Determinar monto abonado y estado de pago
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    -- Calcular total de pagos
    SELECT COALESCE(SUM((p->>'monto')::DECIMAL), 0) INTO v_total_pagos
    FROM jsonb_array_elements(p_pagos) AS p;
    v_monto_abonado := v_total_pagos;
  ELSE
    -- Backwards compatible: usar p_total como monto abonado (pago completo)
    v_monto_abonado := p_total;
  END IF;

  IF v_monto_abonado >= p_total THEN
    v_estado_pago := 'PAGADO';
  ELSIF v_monto_abonado > 0 THEN
    v_estado_pago := 'PAGADO_PARCIAL';
  ELSE
    v_estado_pago := 'PENDIENTE';
  END IF;

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
    v_monto_abonado,
    v_estado_pago,
    NULLIF(p_observaciones, ''),
    p_org_id
  ) RETURNING id INTO v_venta_id;

  -- 4. Create payment records
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    -- Múltiples pagos
    FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
    LOOP
      -- Si es CUENTA_CORRIENTE, descontar del saldo
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
  ELSE
    -- Backwards compatible: un solo pago con el total
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
    'items', v_items_ids
  );
END;
$$ LANGUAGE plpgsql;
