-- ========================================
-- 202: SUCURSALES — columnas sucursal_id + backfill (SIN NOT NULL)
-- ========================================
-- Agrega sucursal_id a las entidades operativas y vuelca toda la data
-- existente a la Casa Central de su org. Columnas quedan NULLABLE.
-- Idempotente: ADD COLUMN IF NOT EXISTS + backfill por WHERE sucursal_id IS NULL.
--
-- SEGURIDAD EN PROD: esta migración es ADITIVA y NO rompe el código actual.
-- Las columnas son nullable; los INSERT existentes (que aún no setean
-- sucursal_id) las omiten y quedan en NULL. El backfill cubre las filas viejas.
-- El SET NOT NULL se aplica en una migración POSTERIOR (Fase 2), recién cuando
-- el app-layer ya escribe sucursal_id en cada INSERT. Aplicar NOT NULL ahora
-- rompería la creación de órdenes/ventas/caja en producción.

-- ========================================
-- 1. AGREGAR COLUMNAS (nullable primero)
-- ========================================

ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE ventas           ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE sesiones_caja    ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE depositos        ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE users            ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);

-- ========================================
-- 2. BACKFILL: data existente -> Casa Central de su org
-- ========================================
-- Helper CTE no aplica entre statements; repetimos el JOIN al principal.

UPDATE ordenes_servicio t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE ventas t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE sesiones_caja t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE movimientos_caja t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE depositos t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

-- users: solo TECNICO/VENDEDOR quedan atados a Casa Central.
-- ADMIN queda NULL (= ve todas las sucursales).
UPDATE users t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND t.rol <> 'ADMIN'
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

-- ========================================
-- 3. NOT NULL — DIFERIDO A FASE 2
-- ========================================
-- NO aplicar SET NOT NULL en esta fase: el código actual aún inserta sin
-- sucursal_id y NOT NULL sin default rompería esos INSERT en producción.
-- Una migración de Fase 2 (post app-layer) aplicará:
--   ALTER TABLE ordenes_servicio ALTER COLUMN sucursal_id SET NOT NULL;
--   ALTER TABLE ventas           ALTER COLUMN sucursal_id SET NOT NULL;
--   ALTER TABLE sesiones_caja    ALTER COLUMN sucursal_id SET NOT NULL;
--   ALTER TABLE movimientos_caja ALTER COLUMN sucursal_id SET NOT NULL;
--   ALTER TABLE depositos        ALTER COLUMN sucursal_id SET NOT NULL;
-- users.sucursal_id queda nullable siempre (ADMIN = NULL = ve todas).

-- ========================================
-- 4. ÍNDICES COMPUESTOS (espejo de los (organization_id, ...) existentes)
-- ========================================

CREATE INDEX IF NOT EXISTS ordenes_org_sucursal_fecha_idx
  ON ordenes_servicio(organization_id, sucursal_id, fecha_ingreso);
CREATE INDEX IF NOT EXISTS ventas_org_sucursal_idx
  ON ventas(organization_id, sucursal_id);
CREATE INDEX IF NOT EXISTS sesiones_caja_org_sucursal_estado_idx
  ON sesiones_caja(organization_id, sucursal_id, estado);
CREATE INDEX IF NOT EXISTS movimientos_caja_org_sucursal_idx
  ON movimientos_caja(organization_id, sucursal_id);
CREATE INDEX IF NOT EXISTS depositos_org_sucursal_idx
  ON depositos(organization_id, sucursal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_org_sucursal_idx
  ON users(organization_id, sucursal_id);
