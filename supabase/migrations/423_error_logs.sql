-- ============================================================================
-- 423: registro central de errores del sistema (error_logs)
-- ============================================================================
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/423_error_logs.sql
-- (dry-run por defecto, --apply para confirmar). Sin BEGIN/COMMIT a proposito.
-- Solo crea una tabla nueva: se puede aplicar antes o despues de mergear. Si el
-- codigo corre sin la tabla, el registro falla en silencio (lib/error-log.ts
-- nunca lanza) y el resto del sistema sigue igual.
--
-- PROBLEMA
-- Un error inesperado solo quedaba en los logs de Vercel (que rotan) o en la
-- consola del navegador del taller. Nadie se enteraba hasta que el taller
-- escribia a soporte, y soporte no tenia con que buscarlo.
--
-- QUE GUARDA
-- Una fila por error no controlado: del servidor (rutas de API, paginas, crons,
-- webhooks) y de las pantallas (las paginas de error reportan). `ref` es el
-- codigo corto que ve el taller ("E-4F7K2Q") para pasarselo a soporte.
-- `fingerprint` agrupa repeticiones del mismo error para la alerta por mail.
-- No se guardan cuerpos de requests ni datos de clientes del taller.

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  source TEXT NOT NULL CHECK (source IN ('API', 'SERVER', 'CLIENT', 'CRON', 'WEBHOOK')),
  ref TEXT NOT NULL,               -- codigo que se le muestra al usuario
  fingerprint TEXT NOT NULL,       -- hash de source + ruta + mensaje normalizado
  digest TEXT,                     -- digest de Next.js (errores de render del servidor)

  route TEXT,                      -- /api/ordenes/[id] o la URL de la pantalla
  method TEXT,
  status INT,

  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT,
  tenant_slug TEXT,

  message TEXT NOT NULL,
  stack TEXT,
  context JSONB,
  user_agent TEXT,

  alerted_at TIMESTAMPTZ           -- cuando se mando la alerta por este error
);

CREATE INDEX IF NOT EXISTS idx_error_logs_occurred_at ON error_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_fingerprint ON error_logs (fingerprint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_ref ON error_logs (ref);
CREATE INDEX IF NOT EXISTS idx_error_logs_digest ON error_logs (digest) WHERE digest IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_logs_org ON error_logs (organization_id, occurred_at DESC)
  WHERE organization_id IS NOT NULL;

-- RLS: solo el service role (el registro corre con supabaseAdmin).
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "error_logs_no_public_access" ON error_logs;
CREATE POLICY "error_logs_no_public_access"
  ON error_logs
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE error_logs IS
  'Errores no controlados del sistema (servidor y pantallas). ref = codigo que ve el taller; fingerprint agrupa repeticiones para la alerta al superadmin.';
