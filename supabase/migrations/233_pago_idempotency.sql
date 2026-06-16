-- Migration 233: Request-level idempotency barrier for /api/ventas/[id]/pagos
-- Prevents double-charge on offline sync retries by deduplicating at the
-- request level (one row per submit attempt, keyed by organization + UUID).

-- Idempotency barrier table for POST /api/ventas/[id]/pagos.
-- A row is claimed (response IS NULL) as soon as the request passes all
-- validations. The response JSONB is filled after the mutation succeeds.
-- A retry that finds an existing row with a non-null response replays it
-- without re-running any money mutation. A retry that finds a null response
-- means the original request is still in flight (or crashed) → 409.
-- Poison-row cleanup: the route DELETEs the row on any error after claim,
-- so a subsequent retry can re-claim instead of getting a stuck 409.
-- Access: service-role only (supabaseAdmin bypasses RLS).
-- No anon / authenticated policies are intentionally created here.
CREATE TABLE IF NOT EXISTS pago_idempotency (
  organization_id TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  venta_id        TEXT        NOT NULL,
  response        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key)
);

COMMENT ON TABLE pago_idempotency IS
  'Request-level idempotency barrier for /api/ventas/[id]/pagos. '
  'Prevents double CC deductions and duplicate pagos_venta rows on offline '
  'sync retries. Accessed exclusively via the service-role client (supabaseAdmin). '
  'No public or authenticated RLS policies — RLS is enabled but intentionally '
  'left without policies so only the service role can read/write.';

-- Enable RLS. No policies are added; service-role bypasses RLS automatically.
ALTER TABLE pago_idempotency ENABLE ROW LEVEL SECURITY;
