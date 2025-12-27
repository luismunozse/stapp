-- ========================================
-- ENUMS
-- ========================================

CREATE TYPE user_role AS ENUM ('ADMIN', 'TECNICO', 'VENDEDOR');

CREATE TYPE estado_orden AS ENUM (
  'PENDIENTE',
  'EN_REPARACION',
  'ESPERANDO_REPUESTO',
  'COMPLETADO',
  'ENTREGADO',
  'CANCELADO'
);

CREATE TYPE tipo_dispositivo AS ENUM (
  'CELULAR',
  'COMPUTADORA',
  'TABLET',
  'CONSOLA',
  'SMARTWATCH',
  'TODOS'
);

CREATE TYPE estado_pago AS ENUM ('PENDIENTE', 'PAGADO_PARCIAL', 'PAGADO');

CREATE TYPE estado_cotizacion AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA');

CREATE TYPE estado_garantia AS ENUM ('ACTIVA', 'VENCIDA', 'RECLAMADA');

CREATE TYPE estado_reclamo AS ENUM (
  'PENDIENTE',
  'EN_REVISION',
  'ACEPTADO',
  'RECHAZADO',
  'RESUELTO'
);

CREATE TYPE tipo_foto AS ENUM ('INGRESO', 'REPARACION', 'ENTREGA');

CREATE TYPE tipo_notificacion AS ENUM (
  'CAMBIO_ESTADO',
  'PRESUPUESTO_DEFINIDO',
  'GARANTIA_CREADA',
  'RECORDATORIO_RETIRO'
);

CREATE TYPE canal_notificacion AS ENUM ('EMAIL', 'WHATSAPP');

CREATE TYPE estado_notificacion AS ENUM ('ENVIADO', 'FALLIDO', 'PENDIENTE');

CREATE TYPE tipo_checklist AS ENUM ('BOOLEAN', 'TEXT', 'SELECT');

CREATE TYPE categoria_checklist AS ENUM (
  'CONDICION_FISICA',
  'ACCESORIOS',
  'FUNCIONAL',
  'OTRO',
  'GENERAL'
);

CREATE TYPE metodo_pago AS ENUM ('EFECTIVO', 'TRANSFERENCIA');

-- ========================================
-- FUNCIONES AUXILIARES
-- ========================================

-- Función para generar CUID-like IDs
CREATE OR REPLACE FUNCTION generate_cuid()
RETURNS TEXT AS $$
DECLARE
  timestamp_part TEXT;
  random_part TEXT;
BEGIN
  timestamp_part := LPAD(TO_HEX(EXTRACT(EPOCH FROM NOW())::BIGINT), 8, '0');
  random_part := ENCODE(GEN_RANDOM_BYTES(8), 'hex');
  RETURN 'c' || timestamp_part || random_part;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- ORGANIZACIONES (Multi-tenant)
-- ========================================

CREATE TABLE organizations (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  nombre TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Logo en Supabase Storage
  logo_url TEXT,
  logo_path TEXT,
  nombre_mostrar TEXT DEFAULT 'Servicio Técnico',

  -- Configuración de notificaciones
  notificaciones_email BOOLEAN DEFAULT TRUE,
  notificaciones_whatsapp BOOLEAN DEFAULT TRUE,
  dias_recordatorio INTEGER DEFAULT 3
);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Contadores atómicos por organización
CREATE TABLE organization_counters (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  next_order_number INTEGER DEFAULT 1,
  next_quote_number INTEGER DEFAULT 1,
  next_invoice_number INTEGER DEFAULT 1
);

-- ========================================
-- USUARIOS
-- ========================================

CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol user_role NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Reset de contraseña
  reset_token TEXT,
  reset_token_expiry TIMESTAMPTZ
);

CREATE INDEX users_organization_id_idx ON users(organization_id);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- CLIENTES
-- ========================================

CREATE TABLE clientes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL,
  email TEXT,
  direccion TEXT,
  dni TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, telefono)
);

CREATE INDEX clientes_organization_id_idx ON clientes(organization_id);
CREATE INDEX clientes_organization_nombre_idx ON clientes(organization_id, nombre);

CREATE TRIGGER clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- ÓRDENES DE SERVICIO
-- ========================================

CREATE TABLE ordenes_servicio (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  numero_orden INTEGER NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tecnico_id TEXT REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dispositivo TEXT NOT NULL,
  tipo_dispositivo tipo_dispositivo NOT NULL,
  problema_reportado TEXT NOT NULL,
  estado estado_orden DEFAULT 'PENDIENTE',
  presupuesto DECIMAL(10,2),
  costo_final DECIMAL(10,2),
  fecha_ingreso TIMESTAMPTZ DEFAULT NOW(),
  fecha_prometida TIMESTAMPTZ,
  fecha_completado TIMESTAMPTZ,
  observaciones TEXT,
  diagnostico TEXT,

  UNIQUE(organization_id, numero_orden)
);

CREATE INDEX ordenes_estado_idx ON ordenes_servicio(estado);
CREATE INDEX ordenes_cliente_id_idx ON ordenes_servicio(cliente_id);
CREATE INDEX ordenes_tecnico_id_idx ON ordenes_servicio(tecnico_id);
CREATE INDEX ordenes_organization_id_idx ON ordenes_servicio(organization_id);
CREATE INDEX ordenes_org_created_idx ON ordenes_servicio(organization_id, fecha_ingreso);
CREATE INDEX ordenes_org_estado_fecha_idx ON ordenes_servicio(organization_id, estado, fecha_ingreso);
CREATE INDEX ordenes_org_tecnico_estado_idx ON ordenes_servicio(organization_id, tecnico_id, estado);
CREATE INDEX ordenes_org_cliente_idx ON ordenes_servicio(organization_id, cliente_id);

-- ========================================
-- FOTOS DE ÓRDENES (Supabase Storage)
-- ========================================

CREATE TABLE fotos_orden (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER,
  descripcion TEXT,
  tipo tipo_foto DEFAULT 'REPARACION',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX fotos_orden_id_idx ON fotos_orden(orden_id);
CREATE INDEX fotos_tipo_idx ON fotos_orden(tipo);

-- ========================================
-- INVENTARIO
-- ========================================

CREATE TABLE inventario (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT NOT NULL,
  tipo_dispositivo tipo_dispositivo NOT NULL,
  stock INTEGER DEFAULT 0,
  precio_compra DECIMAL(10,2) NOT NULL,
  precio_venta DECIMAL(10,2) NOT NULL,
  proveedor TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, codigo)
);

CREATE INDEX inventario_categoria_idx ON inventario(categoria);
CREATE INDEX inventario_tipo_dispositivo_idx ON inventario(tipo_dispositivo);
CREATE INDEX inventario_organization_id_idx ON inventario(organization_id);

CREATE TRIGGER inventario_updated_at
  BEFORE UPDATE ON inventario
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Relación orden-repuesto
CREATE TABLE repuestos_orden (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  inventario_id TEXT NOT NULL REFERENCES inventario(id),
  cantidad INTEGER NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL
);

CREATE INDEX repuestos_orden_id_idx ON repuestos_orden(orden_id);
CREATE INDEX repuestos_inventario_id_idx ON repuestos_orden(inventario_id);

-- ========================================
-- FACTURACIÓN
-- ========================================

CREATE TABLE facturas (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT UNIQUE NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  numero_factura TEXT NOT NULL,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  subtotal DECIMAL(10,2) NOT NULL,
  iva DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  monto_abonado DECIMAL(10,2) DEFAULT 0,
  estado_pago estado_pago DEFAULT 'PENDIENTE'
);

CREATE INDEX facturas_numero_idx ON facturas(numero_factura);
CREATE INDEX facturas_estado_pago_idx ON facturas(estado_pago);
CREATE INDEX facturas_estado_fecha_idx ON facturas(estado_pago, fecha);

CREATE TABLE pagos_parciales (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  factura_id TEXT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  monto DECIMAL(10,2) NOT NULL,
  metodo_pago metodo_pago NOT NULL,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  numero_referencia TEXT,
  observaciones TEXT
);

CREATE INDEX pagos_factura_id_idx ON pagos_parciales(factura_id);

-- ========================================
-- PROVEEDORES
-- ========================================

CREATE TABLE proveedores (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  nombre TEXT NOT NULL,
  telefono TEXT,
  whatsapp TEXT,
  email TEXT,
  direccion TEXT,
  website TEXT,
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, nombre)
);

CREATE INDEX proveedores_organization_id_idx ON proveedores(organization_id);

CREATE TRIGGER proveedores_updated_at
  BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- COTIZACIONES
-- ========================================

CREATE TABLE cotizaciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  numero_cotizacion TEXT NOT NULL,
  estado estado_cotizacion DEFAULT 'BORRADOR',
  fecha_vencimiento TIMESTAMPTZ,
  notas TEXT,
  subtotal DECIMAL(10,2) NOT NULL,
  iva DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Firma de aprobación (Supabase Storage)
  firma_url TEXT,
  firma_path TEXT,
  fecha_aprobacion TIMESTAMPTZ
);

CREATE INDEX cotizaciones_orden_id_idx ON cotizaciones(orden_id);
CREATE INDEX cotizaciones_estado_idx ON cotizaciones(estado);

CREATE TRIGGER cotizaciones_updated_at
  BEFORE UPDATE ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE items_cotizacion (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL
);

CREATE INDEX items_cotizacion_id_idx ON items_cotizacion(cotizacion_id);

-- ========================================
-- GARANTÍAS
-- ========================================

CREATE TABLE garantias (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT UNIQUE NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  dias_validez INTEGER DEFAULT 30,
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ NOT NULL,
  estado estado_garantia DEFAULT 'ACTIVA',
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX garantias_estado_idx ON garantias(estado);
CREATE INDEX garantias_fecha_vencimiento_idx ON garantias(fecha_vencimiento);

CREATE TABLE reclamos_garantia (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  garantia_id TEXT NOT NULL REFERENCES garantias(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  estado estado_reclamo DEFAULT 'PENDIENTE',
  orden_reparacion_id TEXT,
  resolucion TEXT,
  fecha_reclamo TIMESTAMPTZ DEFAULT NOW(),
  fecha_resolucion TIMESTAMPTZ
);

CREATE INDEX reclamos_garantia_id_idx ON reclamos_garantia(garantia_id);
CREATE INDEX reclamos_estado_idx ON reclamos_garantia(estado);

-- ========================================
-- CHECKLIST DE RECEPCIÓN
-- ========================================

CREATE TABLE checklist_templates (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT DEFAULT 'Checklist de Recepción',
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, nombre)
);

CREATE INDEX checklist_templates_org_idx ON checklist_templates(organization_id);

CREATE TRIGGER checklist_templates_updated_at
  BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE checklist_template_items (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  template_id TEXT NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tipo tipo_checklist DEFAULT 'BOOLEAN',
  categoria categoria_checklist DEFAULT 'GENERAL',
  opciones TEXT, -- JSON para tipo SELECT
  orden INTEGER DEFAULT 0,
  requerido BOOLEAN DEFAULT FALSE
);

CREATE INDEX checklist_items_template_idx ON checklist_template_items(template_id);

CREATE TABLE checklist_recepcion (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT UNIQUE NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES checklist_templates(id),
  valores TEXT NOT NULL, -- JSON con valores
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Firma digital (Supabase Storage)
  firma_url TEXT,
  firma_path TEXT
);

CREATE INDEX checklist_recepcion_template_idx ON checklist_recepcion(template_id);

CREATE TRIGGER checklist_recepcion_updated_at
  BEFORE UPDATE ON checklist_recepcion
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- NOTIFICACIONES
-- ========================================

CREATE TABLE notification_logs (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  orden_id TEXT REFERENCES ordenes_servicio(id) ON DELETE SET NULL,
  garantia_id TEXT REFERENCES garantias(id) ON DELETE SET NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,

  tipo tipo_notificacion NOT NULL,
  canal canal_notificacion NOT NULL,
  estado estado_notificacion NOT NULL,

  destinatario TEXT NOT NULL,
  asunto TEXT,
  contenido TEXT NOT NULL,
  error_message TEXT,
  metadata TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notification_logs_org_idx ON notification_logs(organization_id);
CREATE INDEX notification_logs_orden_idx ON notification_logs(orden_id);
CREATE INDEX notification_logs_cliente_idx ON notification_logs(cliente_id);
CREATE INDEX notification_logs_tipo_idx ON notification_logs(tipo);
CREATE INDEX notification_logs_created_idx ON notification_logs(created_at);
CREATE INDEX notification_logs_org_tipo_created_idx ON notification_logs(organization_id, tipo, created_at);
CREATE INDEX notification_logs_orden_tipo_idx ON notification_logs(orden_id, tipo);

-- ========================================
-- AUDITORÍA
-- ========================================

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- CREATE, UPDATE, DELETE
  entity TEXT NOT NULL, -- ordenes_servicio, clientes, etc.
  entity_id TEXT NOT NULL,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX audit_logs_org_created_idx ON audit_logs(organization_id, created_at);
CREATE INDEX audit_logs_entity_id_idx ON audit_logs(entity_id);
CREATE INDEX audit_logs_entity_created_idx ON audit_logs(entity, created_at);

-- ========================================
-- FUNCIÓN PARA OBTENER SIGUIENTE NÚMERO DE ORDEN
-- ========================================

CREATE OR REPLACE FUNCTION get_next_order_number(org_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  -- Atomically increment and return
  UPDATE organization_counters
  SET next_order_number = next_order_number + 1
  WHERE organization_id = org_id
  RETURNING next_order_number - 1 INTO next_num;

  -- Si no existe el contador, crearlo
  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_order_number)
    VALUES (org_id, 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_order_number = organization_counters.next_order_number + 1
    RETURNING next_order_number - 1 INTO next_num;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_next_quote_number(org_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  UPDATE organization_counters
  SET next_quote_number = next_quote_number + 1
  WHERE organization_id = org_id
  RETURNING next_quote_number - 1 INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_quote_number)
    VALUES (org_id, 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_quote_number = organization_counters.next_quote_number + 1
    RETURNING next_quote_number - 1 INTO next_num;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_next_invoice_number(org_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  UPDATE organization_counters
  SET next_invoice_number = next_invoice_number + 1
  WHERE organization_id = org_id
  RETURNING next_invoice_number - 1 INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_invoice_number)
    VALUES (org_id, 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_invoice_number = organization_counters.next_invoice_number + 1
    RETURNING next_invoice_number - 1 INTO next_num;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;
