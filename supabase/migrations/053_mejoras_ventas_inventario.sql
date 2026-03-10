-- ========================================
-- 053: Mejoras integrales de inventario y ventas
-- 1. Historial de precios
-- 2. Movimientos de inventario en repuestos de órdenes
-- 3. Items de factura (vinculación cotización → factura)
-- 4. Mejoras en devoluciones (método de reembolso)
-- 5. Control de descuentos (aprobación)
-- 6. Reporte unificado de ingresos
-- ========================================

-- ========================================
-- 1. HISTORIAL DE PRECIOS
-- ========================================

CREATE TABLE IF NOT EXISTS historial_precios (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  precio_compra_anterior NUMERIC,
  precio_compra_nuevo NUMERIC,
  precio_venta_anterior NUMERIC,
  precio_venta_nuevo NUMERIC,
  motivo TEXT,
  usuario_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS historial_precios_inventario_idx ON historial_precios(inventario_id);
CREATE INDEX IF NOT EXISTS historial_precios_org_idx ON historial_precios(organization_id);
CREATE INDEX IF NOT EXISTS historial_precios_created_idx ON historial_precios(created_at DESC);

-- RLS
ALTER TABLE historial_precios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial_precios_org_isolation" ON historial_precios
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

-- ========================================
-- 2. MOVIMIENTOS DE INVENTARIO EN REPUESTOS
-- Actualizar función add_repuesto_inventario para crear movimientos
-- ========================================

CREATE OR REPLACE FUNCTION add_repuesto_inventario(
  p_orden_id TEXT,
  p_inventario_id TEXT,
  p_cantidad INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_stock INTEGER;
  v_precio NUMERIC;
  v_repuesto_id TEXT;
  v_org_id TEXT;
BEGIN
  -- Obtener stock, precio y org_id con lock
  SELECT stock, precio_venta, organization_id INTO v_stock, v_precio, v_org_id
  FROM inventario
  WHERE id = p_inventario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  IF v_stock < p_cantidad THEN
    RETURN json_build_object('error', 'Stock insuficiente');
  END IF;

  -- Insertar repuesto
  INSERT INTO repuestos_orden (orden_id, inventario_id, cantidad, precio_unitario)
  VALUES (p_orden_id, p_inventario_id, p_cantidad, v_precio)
  RETURNING id INTO v_repuesto_id;

  -- Decrementar stock
  UPDATE inventario
  SET stock = stock - p_cantidad
  WHERE id = p_inventario_id;

  -- Registrar movimiento de inventario
  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id
  ) VALUES (
    p_inventario_id, 'SALIDA', p_cantidad, v_stock, v_stock - p_cantidad,
    p_orden_id, 'orden_servicio',
    'Repuesto asignado a orden de servicio',
    v_org_id
  );

  RETURN json_build_object('success', true, 'id', v_repuesto_id);
END;
$$ LANGUAGE plpgsql;

-- Actualizar función remove_repuesto_inventario para crear movimientos
CREATE OR REPLACE FUNCTION remove_repuesto_inventario(
  p_repuesto_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_inventario_id TEXT;
  v_cantidad INTEGER;
  v_orden_id TEXT;
  v_stock INTEGER;
  v_org_id TEXT;
BEGIN
  -- Obtener datos del repuesto y eliminarlo
  DELETE FROM repuestos_orden
  WHERE id = p_repuesto_id
  RETURNING inventario_id, cantidad, orden_id INTO v_inventario_id, v_cantidad, v_orden_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Repuesto no encontrado');
  END IF;

  -- Restaurar stock si era de inventario
  IF v_inventario_id IS NOT NULL THEN
    -- Obtener stock actual con lock
    SELECT stock, organization_id INTO v_stock, v_org_id
    FROM inventario
    WHERE id = v_inventario_id
    FOR UPDATE;

    UPDATE inventario
    SET stock = stock + v_cantidad
    WHERE id = v_inventario_id;

    -- Registrar movimiento de inventario
    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, observaciones, organization_id
    ) VALUES (
      v_inventario_id, 'ENTRADA', v_cantidad, v_stock, v_stock + v_cantidad,
      v_orden_id, 'orden_servicio',
      'Repuesto removido de orden de servicio - stock restaurado',
      v_org_id
    );
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 3. ITEMS DE FACTURA (vinculación cotización → factura)
-- ========================================

CREATE TABLE IF NOT EXISTS items_factura (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  factura_id TEXT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  cotizacion_item_id TEXT REFERENCES items_cotizacion(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC NOT NULL CHECK (precio_unitario >= 0),
  subtotal NUMERIC NOT NULL CHECK (subtotal >= 0),
  tipo TEXT NOT NULL DEFAULT 'SERVICIO' CHECK (tipo IN ('SERVICIO', 'REPUESTO', 'MANO_DE_OBRA', 'OTRO')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS items_factura_factura_idx ON items_factura(factura_id);

-- Agregar columna cotizacion_id a facturas para vincularlas
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS cotizacion_id TEXT REFERENCES cotizaciones(id) ON DELETE SET NULL;

-- RLS (items_factura hereda acceso via factura → orden → organization)
ALTER TABLE items_factura ENABLE ROW LEVEL SECURITY;

-- Policy basada en join con facturas que ya tienen RLS
CREATE POLICY "items_factura_access" ON items_factura
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facturas f
      JOIN ordenes_servicio o ON f.orden_id = o.id
      WHERE f.id = items_factura.factura_id
      AND o.organization_id = current_setting('app.organization_id', true)
    )
  );

-- ========================================
-- 4. MEJORAS EN DEVOLUCIONES (método de reembolso)
-- ========================================

-- Tipo de método de reembolso
DO $$ BEGIN
  CREATE TYPE metodo_reembolso AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CREDITO_TIENDA', 'OTRO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE devoluciones_venta ADD COLUMN IF NOT EXISTS metodo_reembolso metodo_reembolso;
ALTER TABLE devoluciones_venta ADD COLUMN IF NOT EXISTS reembolso_referencia TEXT;
ALTER TABLE devoluciones_venta ADD COLUMN IF NOT EXISTS fecha_reembolso TIMESTAMPTZ;
ALTER TABLE devoluciones_venta ADD COLUMN IF NOT EXISTS reembolso_procesado_por TEXT REFERENCES users(id) ON DELETE SET NULL;

-- ========================================
-- 5. CONTROL DE DESCUENTOS (aprobación)
-- ========================================

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento_aprobado_por TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento_motivo TEXT;

-- ========================================
-- 6. VISTA UNIFICADA DE INGRESOS
-- ========================================

CREATE OR REPLACE VIEW vista_ingresos_unificados AS
-- Ingresos de ventas POS
SELECT
  v.id,
  'VENTA' AS tipo_ingreso,
  v.numero_venta::TEXT AS numero,
  v.cliente_nombre,
  v.total AS monto,
  v.descuento,
  v.metodo_pago::TEXT AS metodo_pago,
  v.estado::TEXT AS estado,
  v.organization_id,
  v.created_at AS fecha
FROM ventas v
WHERE v.estado = 'COMPLETADA'

UNION ALL

-- Ingresos de órdenes de servicio (via facturas)
SELECT
  f.id,
  'SERVICIO' AS tipo_ingreso,
  f.numero_factura AS numero,
  c.nombre AS cliente_nombre,
  f.total AS monto,
  0 AS descuento,
  COALESCE(
    (SELECT pp.metodo_pago::TEXT FROM pagos_parciales pp WHERE pp.factura_id = f.id ORDER BY pp.fecha DESC LIMIT 1),
    'PENDIENTE'
  ) AS metodo_pago,
  f.estado_pago::TEXT AS estado,
  o.organization_id,
  f.fecha AS fecha
FROM facturas f
JOIN ordenes_servicio o ON f.orden_id = o.id
LEFT JOIN clientes c ON o.cliente_id = c.id;

-- ========================================
-- 7. FUNCIÓN PARA REGISTRAR CAMBIO DE PRECIO
-- ========================================

CREATE OR REPLACE FUNCTION registrar_cambio_precio()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo registrar si realmente cambió algún precio
  IF (OLD.precio_compra IS DISTINCT FROM NEW.precio_compra) OR
     (OLD.precio_venta IS DISTINCT FROM NEW.precio_venta) THEN
    INSERT INTO historial_precios (
      inventario_id,
      precio_compra_anterior, precio_compra_nuevo,
      precio_venta_anterior, precio_venta_nuevo,
      organization_id
    ) VALUES (
      NEW.id,
      OLD.precio_compra, NEW.precio_compra,
      OLD.precio_venta, NEW.precio_venta,
      NEW.organization_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger automático al cambiar precios
DROP TRIGGER IF EXISTS trigger_registrar_cambio_precio ON inventario;
CREATE TRIGGER trigger_registrar_cambio_precio
  AFTER UPDATE ON inventario
  FOR EACH ROW
  EXECUTE FUNCTION registrar_cambio_precio();
