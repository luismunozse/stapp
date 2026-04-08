-- ============================================
-- MEJORAS DE SEGUIMIENTO DE ÓRDENES
-- 068: SLA, Cuotas, Re-ingreso, Token expiry, Audit cobros
-- ============================================

-- ============================================
-- 1. SLA: Tracking de tiempo por estado
-- ============================================

CREATE TABLE IF NOT EXISTS orden_tiempos_estado (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estado TEXT NOT NULL,
  inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fin TIMESTAMPTZ,
  duracion_minutos INTEGER GENERATED ALWAYS AS (
    CASE WHEN fin IS NOT NULL
      THEN EXTRACT(EPOCH FROM (fin - inicio)) / 60
      ELSE NULL
    END
  ) STORED
);

CREATE INDEX idx_orden_tiempos_orden ON orden_tiempos_estado(orden_id);
CREATE INDEX idx_orden_tiempos_org ON orden_tiempos_estado(organization_id);

-- RLS
ALTER TABLE orden_tiempos_estado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_orden_tiempos" ON orden_tiempos_estado
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_orden_tiempos" ON orden_tiempos_estado
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 2. CALENDARIO DE CUOTAS
-- ============================================

CREATE TABLE IF NOT EXISTS cuotas_cobro (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  cobro_id TEXT NOT NULL REFERENCES cobros_orden(id) ON DELETE CASCADE,
  orden_id TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  numero_cuota INTEGER NOT NULL,
  total_cuotas INTEGER NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  pagada BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_pago TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cuotas_cobro_orden ON cuotas_cobro(orden_id);
CREATE INDEX idx_cuotas_cobro_org ON cuotas_cobro(organization_id, fecha_vencimiento);
CREATE INDEX idx_cuotas_pendientes ON cuotas_cobro(organization_id, pagada, fecha_vencimiento)
  WHERE pagada = FALSE;

-- RLS
ALTER TABLE cuotas_cobro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_cuotas_cobro" ON cuotas_cobro
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_cuotas_cobro" ON cuotas_cobro
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 3. RE-INGRESO / GARANTÍA VINCULADA
-- ============================================

-- Campo para vincular orden de re-ingreso con orden original
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS orden_origen_id TEXT REFERENCES ordenes_servicio(id);
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS es_reingreso BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS garantia_origen_id TEXT;

CREATE INDEX idx_orden_reingreso ON ordenes_servicio(orden_origen_id) WHERE orden_origen_id IS NOT NULL;

-- ============================================
-- 4. EXPIRACIÓN DE PUBLIC_TOKEN POST-ENTREGA
-- ============================================

-- Campo para marcar expiración del token público
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS public_token_expires_at TIMESTAMPTZ;

-- ============================================
-- 5. AUDIT TRAIL PARA COBROS (soft-delete)
-- ============================================

ALTER TABLE cobros_orden ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cobros_orden ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
ALTER TABLE cobros_orden ADD COLUMN IF NOT EXISTS anulado_por TEXT REFERENCES users(id);
ALTER TABLE cobros_orden ADD COLUMN IF NOT EXISTS anulado_motivo TEXT;

-- ============================================
-- 6. FUNCIÓN ACTUALIZADA: recalcular sin contar anulados
-- ============================================

CREATE OR REPLACE FUNCTION recalcular_estado_cobro(p_orden_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_total_cobrado DECIMAL;
  v_costo_final DECIMAL;
  v_descuento DECIMAL;
  v_estado TEXT;
BEGIN
  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM cobros_orden WHERE orden_id = p_orden_id AND anulado = FALSE;

  SELECT COALESCE(costo_final, 0), COALESCE(descuento_cobro, 0)
  INTO v_costo_final, v_descuento
  FROM ordenes_servicio WHERE id = p_orden_id;

  v_costo_final := v_costo_final - v_descuento;

  IF v_costo_final <= 0 THEN
    v_estado := 'PENDIENTE';
  ELSIF v_total_cobrado >= v_costo_final THEN
    v_estado := 'COBRADO';
  ELSIF v_total_cobrado > 0 THEN
    v_estado := 'PARCIAL';
  ELSE
    v_estado := 'PENDIENTE';
  END IF;

  UPDATE ordenes_servicio
  SET total_cobrado = v_total_cobrado,
      estado_cobro = v_estado
  WHERE id = p_orden_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. FUNCIÓN: Registrar tiempo en estado
-- ============================================

CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  -- Cerrar el tiempo del estado anterior
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    -- Cast explícito a text: orden_tiempos_estado.estado es TEXT mientras
    -- ordenes_servicio.estado es el enum estado_orden, y Postgres no tiene
    -- cast implícito entre ambos en operadores de comparación.
    UPDATE orden_tiempos_estado
    SET fin = NOW()
    WHERE orden_id = NEW.id AND estado = OLD.estado::text AND fin IS NULL;

    -- Abrir nuevo registro de tiempo para el nuevo estado
    INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
    VALUES (NEW.id, NEW.organization_id, NEW.estado::text, NOW());

    -- Si el nuevo estado es ENTREGADO, expirar el token público en 30 días
    IF NEW.estado = 'ENTREGADO' THEN
      UPDATE ordenes_servicio
      SET public_token_expires_at = NOW() + INTERVAL '30 days'
      WHERE id = NEW.id AND public_token_expires_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para registrar cambios de estado automáticamente
DROP TRIGGER IF EXISTS trg_orden_cambio_estado_tiempo ON ordenes_servicio;
CREATE TRIGGER trg_orden_cambio_estado_tiempo
  AFTER UPDATE OF estado ON ordenes_servicio
  FOR EACH ROW
  EXECUTE FUNCTION registrar_cambio_estado_tiempo();

-- Backfill: crear registro inicial para órdenes existentes que no están en estado terminal
-- Usa fecha_ingreso (siempre seteada por DEFAULT NOW() en 001_schema.sql) — la tabla
-- ordenes_servicio no tiene columna created_at.
INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
SELECT id, organization_id, estado, fecha_ingreso
FROM ordenes_servicio
WHERE estado NOT IN ('ENTREGADO', 'CANCELADO', 'SIN_REPARACION')
  AND fecha_ingreso IS NOT NULL
ON CONFLICT DO NOTHING;
