-- ============================================
-- 192: Catálogo — carritos abandonados (lead recovery)
-- ============================================
-- Guarda snapshot del carrito cuando el visitante completó datos de contacto
-- (nombre + teléfono) pero no llegó a enviar la solicitud. Permite al admin
-- contactarlo manualmente vía WhatsApp para recuperar la venta.
--
-- Flujo:
--   1. Cliente abre cart drawer y completa nombre/tel/email → POST /abandono
--      hace upsert por (organization_id, slug, visitor_hash || telefono).
--   2. Si después completa cotizar, ese flujo marca recovered_at + cotizacion_id.
--   3. Admin ve lista en panel y puede mandar template WhatsApp.
-- ============================================

CREATE TABLE IF NOT EXISTS catalogo_carritos_abandonados (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  catalogo_slug     TEXT NOT NULL,
  visitor_hash      TEXT,
  cliente_nombre    TEXT NOT NULL,
  cliente_telefono  TEXT NOT NULL,
  cliente_email     TEXT,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_estimado    DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total_estimado >= 0),
  cupon_codigo      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovered_at      TIMESTAMPTZ,
  cotizacion_id     TEXT REFERENCES cotizaciones(id) ON DELETE SET NULL,
  contacted_at      TIMESTAMPTZ,
  contacted_by      TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Un carrito activo por (org, telefono) — siguiente snapshot del mismo tel reemplaza
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_carritos_abandonados_unique_tel
  ON catalogo_carritos_abandonados(organization_id, cliente_telefono)
  WHERE recovered_at IS NULL;

CREATE INDEX IF NOT EXISTS catalogo_carritos_abandonados_org_fecha
  ON catalogo_carritos_abandonados(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS catalogo_carritos_abandonados_pendientes
  ON catalogo_carritos_abandonados(organization_id, recovered_at)
  WHERE recovered_at IS NULL;

DROP TRIGGER IF EXISTS catalogo_carritos_abandonados_updated_at
  ON catalogo_carritos_abandonados;
CREATE TRIGGER catalogo_carritos_abandonados_updated_at
  BEFORE UPDATE ON catalogo_carritos_abandonados
  FOR EACH ROW EXECUTE FUNCTION catalogo_set_updated_at();

ALTER TABLE catalogo_carritos_abandonados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org puede ver sus carritos abandonados"
  ON catalogo_carritos_abandonados FOR SELECT
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY "Org puede gestionar sus carritos abandonados"
  ON catalogo_carritos_abandonados FOR ALL
  USING (organization_id = public.get_current_organization_id());

COMMENT ON TABLE catalogo_carritos_abandonados IS
  'Snapshots de carritos públicos no finalizados, para recuperación manual vía WhatsApp.';
COMMENT ON COLUMN catalogo_carritos_abandonados.items IS
  'Array JSONB: [{ itemId, varianteId?, nombre, cantidad, precio_unitario, subtotal }]';
COMMENT ON COLUMN catalogo_carritos_abandonados.recovered_at IS
  'Si NOT NULL, el carrito se convirtió en cotización (cotizacion_id).';
