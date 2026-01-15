-- ========================================
-- MODULO DE VENTAS
-- ========================================

-- ========================================
-- ENUMS
-- ========================================

CREATE TYPE metodo_pago_venta AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA');
CREATE TYPE estado_venta AS ENUM ('COMPLETADA', 'ANULADA');
CREATE TYPE estado_garantia_venta AS ENUM ('ACTIVA', 'VENCIDA', 'RECLAMADA');

-- ========================================
-- TABLA: ventas
-- ========================================

CREATE TABLE ventas (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  numero_venta INTEGER NOT NULL,
  cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_telefono TEXT,
  vendedor_id TEXT NOT NULL REFERENCES users(id),
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  descuento DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  metodo_pago metodo_pago_venta NOT NULL,
  estado estado_venta DEFAULT 'COMPLETADA',
  observaciones TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, numero_venta)
);

CREATE INDEX ventas_organization_id_idx ON ventas(organization_id);
CREATE INDEX ventas_vendedor_id_idx ON ventas(vendedor_id);
CREATE INDEX ventas_cliente_id_idx ON ventas(cliente_id);
CREATE INDEX ventas_estado_idx ON ventas(estado);
CREATE INDEX ventas_created_at_idx ON ventas(created_at);

CREATE TRIGGER ventas_updated_at
  BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- TABLA: items_venta
-- ========================================

CREATE TABLE items_venta (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  venta_id TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  inventario_id TEXT REFERENCES inventario(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  dias_garantia INTEGER DEFAULT 0
);

CREATE INDEX items_venta_venta_id_idx ON items_venta(venta_id);
CREATE INDEX items_venta_inventario_id_idx ON items_venta(inventario_id);

-- ========================================
-- TABLA: garantias_venta
-- ========================================

CREATE TABLE garantias_venta (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  venta_id TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  item_venta_id TEXT NOT NULL REFERENCES items_venta(id) ON DELETE CASCADE,
  numero_garantia TEXT NOT NULL,
  dias_validez INTEGER NOT NULL,
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ NOT NULL,
  estado estado_garantia_venta DEFAULT 'ACTIVA',
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, numero_garantia)
);

CREATE INDEX garantias_venta_venta_id_idx ON garantias_venta(venta_id);
CREATE INDEX garantias_venta_item_id_idx ON garantias_venta(item_venta_id);
CREATE INDEX garantias_venta_estado_idx ON garantias_venta(estado);
CREATE INDEX garantias_venta_organization_id_idx ON garantias_venta(organization_id);

-- ========================================
-- CONTADORES
-- ========================================

ALTER TABLE organization_counters
ADD COLUMN IF NOT EXISTS next_sale_number INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS next_warranty_sale_number INTEGER DEFAULT 1;

-- Funcion para obtener siguiente numero de venta
CREATE OR REPLACE FUNCTION get_next_sale_number(org_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  UPDATE organization_counters
  SET next_sale_number = next_sale_number + 1
  WHERE organization_id = org_id
  RETURNING next_sale_number - 1 INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_sale_number)
    VALUES (org_id, 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_sale_number = organization_counters.next_sale_number + 1
    RETURNING next_sale_number - 1 INTO next_num;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Funcion para obtener siguiente numero de garantia de venta
CREATE OR REPLACE FUNCTION get_next_warranty_sale_number(org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  UPDATE organization_counters
  SET next_warranty_sale_number = next_warranty_sale_number + 1
  WHERE organization_id = org_id
  RETURNING next_warranty_sale_number - 1 INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_warranty_sale_number)
    VALUES (org_id, 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_warranty_sale_number = organization_counters.next_warranty_sale_number + 1
    RETURNING next_warranty_sale_number - 1 INTO next_num;
  END IF;

  RETURN 'GAR-' || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- TRIGGERS: Actualizar stock
-- ========================================

-- Descontar stock al crear item de venta
CREATE OR REPLACE FUNCTION update_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.inventario_id IS NOT NULL THEN
    UPDATE inventario
    SET stock = stock - NEW.cantidad
    WHERE id = NEW.inventario_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stock_on_sale
  AFTER INSERT ON items_venta
  FOR EACH ROW EXECUTE FUNCTION update_stock_on_sale();

-- Restaurar stock si se anula la venta
CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    UPDATE inventario inv
    SET stock = stock + iv.cantidad
    FROM items_venta iv
    WHERE iv.venta_id = NEW.id
      AND iv.inventario_id = inv.id
      AND iv.inventario_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_restore_stock_on_cancel
  AFTER UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION restore_stock_on_cancel();

-- ========================================
-- RLS POLICIES
-- ========================================

ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE garantias_venta ENABLE ROW LEVEL SECURITY;

-- Ventas: usuarios pueden ver ventas de su organizacion
CREATE POLICY ventas_select ON ventas
  FOR SELECT USING (
    organization_id = current_setting('app.organization_id', true)
  );

CREATE POLICY ventas_insert ON ventas
  FOR INSERT WITH CHECK (
    organization_id = current_setting('app.organization_id', true)
  );

CREATE POLICY ventas_update ON ventas
  FOR UPDATE USING (
    organization_id = current_setting('app.organization_id', true)
  );

CREATE POLICY ventas_delete ON ventas
  FOR DELETE USING (
    organization_id = current_setting('app.organization_id', true)
  );

-- Items venta: acceso via venta
CREATE POLICY items_venta_select ON items_venta
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

CREATE POLICY items_venta_insert ON items_venta
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

CREATE POLICY items_venta_delete ON items_venta
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

-- Garantias venta
CREATE POLICY garantias_venta_select ON garantias_venta
  FOR SELECT USING (
    organization_id = current_setting('app.organization_id', true)
  );

CREATE POLICY garantias_venta_insert ON garantias_venta
  FOR INSERT WITH CHECK (
    organization_id = current_setting('app.organization_id', true)
  );

CREATE POLICY garantias_venta_update ON garantias_venta
  FOR UPDATE USING (
    organization_id = current_setting('app.organization_id', true)
  );
