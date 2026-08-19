-- ============================================================================
-- 298: facturación ARCA directa — WSAA ticket store + lease infra (PR1)
-- ============================================================================
-- Infraestructura de concurrencia para la emisión directa contra AFIP/ARCA
-- (sdd/facturacion-arca-directa, design ADR-02/ADR-05).
--
-- STApp no tiene sesión directa a Postgres en runtime (todo pasa por
-- PostgREST vía supabaseAdmin), así que un pg_advisory_xact_lock tomado
-- dentro de una función .rpc() se libera apenas esa RPC retorna — no puede
-- cubrir una sección crítica que incluye una llamada HTTP a AFIP. Por eso la
-- primitiva de concurrencia es una tabla de leases con TTL; el advisory lock
-- solo se usa DENTRO de las RPCs de adquisición/liberación para que el
-- camino de "tomar un lease expirado" sea una única sección crítica atómica.
--
-- wsaa_tickets cachea el ticket WSAA (token+sign) por org/cuit/servicio/
-- ambiente. Es una credencial bearer de la identidad fiscal de la org: solo
-- service_role puede leerla, nunca se expone a un usuario de la org.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wsaa_tickets (
  id                      TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cuit                    TEXT NOT NULL,
  service                 TEXT NOT NULL DEFAULT 'wsfe',
  production              BOOLEAN NOT NULL,
  token_enc               TEXT NOT NULL,
  sign_enc                TEXT NOT NULL,
  generated_at            TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ NOT NULL,
  ultimo_login_intento_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_wsaa_ticket UNIQUE (organization_id, cuit, service, production)
);

ALTER TABLE wsaa_tickets ENABLE ROW LEVEL SECURITY;

-- Deliberadamente SIN policy de select para usuarios de la org: un ticket
-- WSAA es una credencial bearer de la identidad fiscal, solo service_role.
DROP POLICY IF EXISTS wsaa_tickets_all_service ON wsaa_tickets;
CREATE POLICY wsaa_tickets_all_service ON wsaa_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Defensa en profundidad: Supabase otorga ALL sobre tablas públicas nuevas a
-- anon/authenticated por default, así que RLS no es la única barrera salvo
-- que también se revoque el grant.
REVOKE ALL ON wsaa_tickets FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_wsaa_tickets_expires ON wsaa_tickets(expires_at);

DROP TRIGGER IF EXISTS wsaa_tickets_updated_at ON wsaa_tickets;
CREATE TRIGGER wsaa_tickets_updated_at BEFORE UPDATE ON wsaa_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Lease table (primitiva de concurrencia con TTL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS facturacion_leases (
  lock_key        TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  holder          TEXT NOT NULL,          -- uuid aleatorio, uno por intento (fencing token)
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facturacion_leases_expires ON facturacion_leases(expires_at);

ALTER TABLE facturacion_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facturacion_leases_all_service ON facturacion_leases;
CREATE POLICY facturacion_leases_all_service ON facturacion_leases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON facturacion_leases FROM anon, authenticated;

DROP TRIGGER IF EXISTS facturacion_leases_updated_at ON facturacion_leases;
CREATE TRIGGER facturacion_leases_updated_at BEFORE UPDATE ON facturacion_leases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- RPCs de adquisición/liberación
-- ============================================================================
-- classid 8300 namespacea este subsistema; hashtext() pliega la clave
-- (que puede incluir un cuid de organización) a int4. Una colisión de hash
-- solo produce una serialización espuria (inofensiva), nunca una falla de
-- correctitud: la corrección depende de la primary key y el fencing por
-- holder, no del advisory lock.
CREATE OR REPLACE FUNCTION facturacion_lease_acquire(
  p_lock_key TEXT, p_org_id TEXT, p_holder TEXT, p_ttl_seconds INTEGER
) RETURNS BOOLEAN AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(8300, hashtext(p_lock_key));
  DELETE FROM facturacion_leases WHERE lock_key = p_lock_key AND expires_at < now();
  INSERT INTO facturacion_leases (lock_key, organization_id, holder, expires_at)
  VALUES (p_lock_key, p_org_id, p_holder, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (lock_key) DO NOTHING
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION facturacion_lease_release(p_lock_key TEXT, p_holder TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_n INTEGER;
BEGIN
  DELETE FROM facturacion_leases WHERE lock_key = p_lock_key AND holder = p_holder;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;   -- false: nuestro lease ya había expirado y fue tomado por otro holder
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION facturacion_lease_acquire(TEXT, TEXT, TEXT, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION facturacion_lease_release(TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION facturacion_lease_acquire(TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION facturacion_lease_release(TEXT, TEXT) TO service_role;
