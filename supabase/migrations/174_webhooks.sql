-- ============================================
-- 174: OUTBOUND WEBHOOKS (subscripciones por org)
-- ============================================
-- Permite a cada organización registrar endpoints HTTPS que reciben eventos
-- (inventario.created, venta.completada, etc) firmados con HMAC SHA256.
--
-- Diferente a webhook_events (094): aquélla audita webhooks ENTRANTES
-- (MercadoPago/Rebill). Esta tabla es para webhooks SALIENTES emitidos por
-- nuestro sistema hacia integraciones de terceros.
--
-- Modelo:
--   webhooks            → subscripción (url + eventos + secret HMAC)
--   webhook_deliveries  → log de cada intento de entrega
--
-- Retry/disable: el dispatcher (lib/webhooks/dispatcher.ts) maneja contadores.
-- consecutive_failures >= 10 → activo=false automáticamente (anti-zombies).

-- ============================================
-- 1. TABLA webhooks
-- ============================================

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  -- Hex de 64 chars (32 bytes random). El cliente usa este secret para
  -- verificar X-Webhook-Signature. Solo se muestra al crear; nunca se
  -- devuelve por GET (excepto en respuesta de POST y rotateSecret).
  secret TEXT NOT NULL,
  -- Array de event types suscriptos. Ver EVENT_TYPES en dispatcher.ts.
  events TEXT[] NOT NULL DEFAULT '{}',
  activo BOOLEAN NOT NULL DEFAULT true,
  -- Headers custom opcionales (Authorization, X-Tenant-Id, etc).
  -- Merged con X-Webhook-Signature antes del POST.
  headers JSONB,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhooks_org_idx
  ON webhooks(organization_id)
  WHERE deleted_at IS NULL;

-- GIN sobre events para WHERE 'evento.x' = ANY(events) eficiente al emitir
CREATE INDEX IF NOT EXISTS webhooks_events_gin_idx
  ON webhooks USING GIN(events)
  WHERE deleted_at IS NULL AND activo = true;

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhooks_select ON webhooks;
CREATE POLICY webhooks_select ON webhooks
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS webhooks_all_service ON webhooks;
CREATE POLICY webhooks_all_service ON webhooks
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS webhooks_updated_at ON webhooks;
CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. TABLA webhook_deliveries
-- ============================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCESS','FAILED')),
  http_status INTEGER,
  -- Body truncado a ~2KB en el dispatcher (evita inflar la tabla).
  response_body TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  -- next_retry_at + status=FAILED → cron/retry scanner lo recoge
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_org_idx
  ON webhook_deliveries(organization_id);

CREATE INDEX IF NOT EXISTS webhook_deliveries_event_idx
  ON webhook_deliveries(event);

-- Para retry scanner: barrer FAILED con next_retry_at <= NOW()
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON webhook_deliveries(status, next_retry_at)
  WHERE status IN ('PENDING','FAILED');

-- Para listar deliveries por webhook ordenado por fecha
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_created_idx
  ON webhook_deliveries(webhook_id, created_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS webhook_deliveries_all_service ON webhook_deliveries;
CREATE POLICY webhook_deliveries_all_service ON webhook_deliveries
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE webhooks IS
  'Subscripciones outbound: orgs registran URL + eventos + secret HMAC. Auto-disable si consecutive_failures >= 10.';
COMMENT ON TABLE webhook_deliveries IS
  'Log de intentos de entrega. Source de verdad para retry scanner y UI de historial.';
