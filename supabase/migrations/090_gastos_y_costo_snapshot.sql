-- ============================================
-- Migration 090: Sistema de Gastos y Rentabilidad
-- ============================================
-- Objetivo: permitir calcular Ganancia Neta real (Ingresos - Costos - Gastos)
-- sin romper ningún flujo existente.
--
-- Cambios (TODOS aditivos):
--   1. Tabla categorias_gasto (nueva)
--   2. Tabla gastos_recurrentes (nueva)
--   3. Columnas opcionales en movimientos_caja (categoría, proveedor, comprobante,
--      es_recurrente, afecta_rentabilidad)
--   4. Columna costo_unitario_snapshot en items_venta (NULL en históricos)
--   5. crear_venta_atomica actualizada para llenar el snapshot al insertar items
--   6. Seed de categorías default por organización existente
-- ============================================

-- ========================================
-- 1. Categorías de gasto
-- ========================================

CREATE TABLE IF NOT EXISTS categorias_gasto (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'VARIABLE' CHECK (tipo IN ('FIJO', 'VARIABLE')),
  -- Si es false, los movimientos asociados NO se restan de la ganancia neta
  -- (ej: retiros del dueño, transferencias entre cuentas propias)
  afecta_rentabilidad BOOLEAN NOT NULL DEFAULT TRUE,
  color TEXT,
  icono TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_categorias_gasto_org
  ON categorias_gasto(organization_id, activo);

ALTER TABLE categorias_gasto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_categorias_gasto" ON categorias_gasto
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));

CREATE POLICY "service_role_categorias_gasto" ON categorias_gasto
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER categorias_gasto_updated_at
  BEFORE UPDATE ON categorias_gasto
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. Gastos recurrentes (plantillas)
-- ========================================

CREATE TABLE IF NOT EXISTS gastos_recurrentes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  categoria_gasto_id TEXT REFERENCES categorias_gasto(id) ON DELETE SET NULL,
  concepto TEXT NOT NULL,
  monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  metodo_pago TEXT NOT NULL DEFAULT 'EFECTIVO',
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('SEMANAL', 'MENSUAL', 'ANUAL')),
  dia_del_mes INTEGER CHECK (dia_del_mes BETWEEN 1 AND 31),
  proximo_vencimiento DATE NOT NULL,
  ultimo_generado DATE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gastos_recurrentes_org_activo
  ON gastos_recurrentes(organization_id, activo);
CREATE INDEX IF NOT EXISTS idx_gastos_recurrentes_vencimiento
  ON gastos_recurrentes(proximo_vencimiento) WHERE activo = TRUE;

ALTER TABLE gastos_recurrentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_gastos_recurrentes" ON gastos_recurrentes
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));

CREATE POLICY "service_role_gastos_recurrentes" ON gastos_recurrentes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER gastos_recurrentes_updated_at
  BEFORE UPDATE ON gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 3. Columnas opcionales en movimientos_caja
-- ========================================
-- Todas NULLABLE / con default → no rompe inserts ni queries existentes.

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS categoria_gasto_id TEXT REFERENCES categorias_gasto(id) ON DELETE SET NULL;

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS proveedor_id TEXT;
-- Nota: no agregamos FK a proveedores acá para no acoplar la migración a su existencia.
-- Si la tabla proveedores existe y querés FK, podés agregarla en una migración posterior.

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS comprobante_url TEXT;

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS es_recurrente BOOLEAN NOT NULL DEFAULT FALSE;

-- afecta_rentabilidad: TRUE por default → todos los registros viejos quedan
-- contando como gasto/ingreso "real" (comportamiento esperado retroactivo).
ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS afecta_rentabilidad BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_movimientos_caja_categoria
  ON movimientos_caja(categoria_gasto_id) WHERE categoria_gasto_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_caja_org_tipo_fecha
  ON movimientos_caja(organization_id, tipo, fecha DESC);

-- ========================================
-- 4. Snapshot de costo en items_venta
-- ========================================
-- NULL = venta histórica anterior a esta migración (costo desconocido / usar inventario actual)
-- Valor = costo congelado al momento de la venta

ALTER TABLE items_venta
  ADD COLUMN IF NOT EXISTS costo_unitario_snapshot DECIMAL(10,2);

COMMENT ON COLUMN items_venta.costo_unitario_snapshot IS
  'Costo unitario (precio_compra) del producto al momento de la venta. NULL para ventas previas a la migración 090. Usado para calcular ganancia bruta histórica fiel.';

-- ========================================
-- 5. crear_venta_atomica con snapshot de costo
-- ========================================
-- Único cambio respecto a la versión 079: en el INSERT a items_venta se incluye
-- costo_unitario_snapshot, leído del precio_compra del inventario en ese momento.
-- Si el item no tiene inventarioId (item suelto), el snapshot queda NULL.

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
  v_inv_costo DECIMAL;
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
    -- *** NUEVO: leer costo de compra actual para snapshot ***
    v_inv_costo := NULL;
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT precio_compra INTO v_inv_costo
      FROM inventario
      WHERE id = (v_item->>'inventarioId');
    END IF;

    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento,
      costo_unitario_snapshot
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
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0),
      v_inv_costo  -- *** snapshot del costo al momento de la venta ***
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

-- ========================================
-- 6. Seed: categorías de gasto default por organización existente
-- ========================================
-- Idempotente: ON CONFLICT DO NOTHING usa la UNIQUE (organization_id, nombre).

INSERT INTO categorias_gasto (organization_id, nombre, tipo, afecta_rentabilidad, color, icono)
SELECT o.id, c.nombre, c.tipo, c.afecta_rentabilidad, c.color, c.icono
FROM organizations o
CROSS JOIN (VALUES
  ('Alquiler',              'FIJO',     TRUE,  '#ef4444', 'home'),
  ('Sueldos',               'FIJO',     TRUE,  '#f59e0b', 'users'),
  ('Servicios',             'FIJO',     TRUE,  '#3b82f6', 'zap'),
  ('Internet y telefonía',  'FIJO',     TRUE,  '#06b6d4', 'wifi'),
  ('Impuestos',             'FIJO',     TRUE,  '#8b5cf6', 'file-text'),
  ('Insumos',               'VARIABLE', TRUE,  '#10b981', 'package'),
  ('Mercadería',            'VARIABLE', TRUE,  '#14b8a6', 'shopping-bag'),
  ('Mantenimiento',         'VARIABLE', TRUE,  '#f97316', 'wrench'),
  ('Marketing',             'VARIABLE', TRUE,  '#ec4899', 'megaphone'),
  ('Transporte',            'VARIABLE', TRUE,  '#6366f1', 'truck'),
  ('Otros gastos',          'VARIABLE', TRUE,  '#64748b', 'more-horizontal'),
  ('Retiro de socio',       'VARIABLE', FALSE, '#94a3b8', 'user-minus')
) AS c(nombre, tipo, afecta_rentabilidad, color, icono)
ON CONFLICT (organization_id, nombre) DO NOTHING;
