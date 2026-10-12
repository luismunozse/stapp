-- 300: Servicios asignables a órdenes
--
-- CONTEXTO
-- Un taller tiene servicios con precio prefijado (ej. instalación de Windows).
-- Hoy no puede cargarlos limpio: inventario exige stock, precio_compra y
-- tipo_dispositivo (001_schema.sql:236, 043:20), y cargarlos como repuesto manual
-- es un bug contable, porque repuestos_orden.precio_unitario es COSTO y se resta
-- de la ganancia (151_fix_add_repuesto_precio_compra.sql:72).
--
-- catalogo_items (143:67) ya modela tipo IN ('PRODUCTO','SERVICIO'), pero es la
-- vitrina pública, que arranca apagada (catalogo_config.activo DEFAULT FALSE, 143:31).
-- Acoplar la operación interna a una vitrina opcional mezcla dos ciclos de vida.
--
-- DECISIONES
--   - Sin columna de costo: la fórmula de ganancia está duplicada en 7 lugares y
--     exponer costo sin actualizarlos infla ganancia y comisiones en silencio.
--   - Sin sucursal_id: consistente con inventario, que es catálogo a nivel org.
--   - Precio fijo: sin rango ni tarifa por hora.

-- ========================================
-- CATÁLOGO DE SERVICIOS
-- ========================================

CREATE TABLE servicios (
  id                    TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  codigo                TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  descripcion           TEXT,
  categoria             TEXT,
  precio                DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  duracion_estimada_min INTEGER CHECK (duracion_estimada_min IS NULL OR duracion_estimada_min > 0),
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice único parcial en vez de UNIQUE(organization_id, codigo): permite
-- reutilizar el código de un servicio borrado. Patrón tomado de
-- 083_inventario_critical_fixes.sql:21, donde el UNIQUE plano tuvo que
-- eliminarse justamente por ser incompatible con el soft delete.
CREATE UNIQUE INDEX servicios_org_codigo_uniq
  ON servicios(organization_id, codigo) WHERE deleted_at IS NULL;

CREATE INDEX servicios_org_activo_idx
  ON servicios(organization_id) WHERE activo = TRUE AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS servicios_updated_at ON servicios;
CREATE TRIGGER servicios_updated_at
  BEFORE UPDATE ON servicios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS sigue la convención endurecida de 201_rls_hardening_phase1.sql (201:7-12):
--   - El catch-all de service_role lleva TO service_role explícito. Sin rol,
--     una policy FOR ALL USING(true) aplica a PUBLIC, y Postgres OR-combina
--     policies permisivas, así que ese catch-all anularía el aislamiento por
--     org del SELECT para cualquier rol sujeto a RLS.
--   - El SELECT usa public.get_current_organization_id() en vez del GUC
--     current_setting('app.organization_id', true), que nunca se setea en el
--     flujo normal de requests y siempre resuelve a NULL.
ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servicios_select ON servicios;
CREATE POLICY servicios_select ON servicios
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS servicios_all_service ON servicios;
CREATE POLICY servicios_all_service ON servicios
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ========================================
-- LÍNEAS DE SERVICIO EN UNA ORDEN
-- ========================================

CREATE TABLE servicios_orden (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id        TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  servicio_id     TEXT REFERENCES servicios(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  cantidad        INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX servicios_orden_orden_idx ON servicios_orden(orden_id);

COMMENT ON COLUMN servicios_orden.precio_unitario IS
  'PRECIO DE VENTA (ingreso). Semantica OPUESTA a repuestos_orden.precio_unitario, que es costo (ver 151:72). No copiar la logica de repuestos sin invertir el signo.';

COMMENT ON COLUMN servicios_orden.nombre IS
  'Snapshot del nombre al momento de asignar. Se guarda SIEMPRE, tambien cuando servicio_id no es nulo, para que cambiar o borrar el servicio del catalogo no mute ordenes historicas.';

COMMENT ON COLUMN servicios_orden.servicio_id IS
  'Nullable a proposito: habilita servicios ad-hoc sin alta previa, y ON DELETE SET NULL evita que borrar del catalogo rompa ordenes existentes.';

ALTER TABLE servicios_orden ENABLE ROW LEVEL SECURITY;

-- Hereda acceso vía join con la orden, igual que items_factura (053:168-176).
-- Mismo endurecimiento que en servicios más arriba (201:7-12): TO authenticated
-- + TO service_role explícitos y public.get_current_organization_id() en vez
-- del GUC roto.
DROP POLICY IF EXISTS servicios_orden_select ON servicios_orden;
CREATE POLICY servicios_orden_select ON servicios_orden
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
      WHERE o.id = servicios_orden.orden_id
        AND o.organization_id = public.get_current_organization_id()
    )
  );

DROP POLICY IF EXISTS servicios_orden_all_service ON servicios_orden;
CREATE POLICY servicios_orden_all_service ON servicios_orden
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
