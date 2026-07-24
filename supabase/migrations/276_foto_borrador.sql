-- ============================================================================
-- 276: borradores de fotos para el handoff por QR al crear órdenes
-- ============================================================================
-- Permite sacar las fotos del equipo con el celular mientras se carga la orden
-- desde una PC. El token del QR concede UNA sola capacidad: agregar una imagen
-- a un borrador. Se guarda hasheado (SHA-256) — el token crudo vive solo en el
-- QR en pantalla — y vence a los 5 minutos.
--
-- El staging es transporte: al crear la orden las fotos viajan por el payload
-- actual de POST /api/ordenes, así que acá NO se cuentan contra la cuota de
-- storage del plan (se estarían contando dos veces).
-- ============================================================================

CREATE TABLE IF NOT EXISTS foto_borrador (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT REFERENCES sucursales(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE foto_borrador IS
  'Sesión efímera de subida de fotos por QR. El token vive solo hasheado; el borrador sobrevive al vencimiento del token para no perder fotos ya subidas.';
COMMENT ON COLUMN foto_borrador.token_hash IS
  'SHA-256 hex del token crudo. El token crudo nunca se persiste.';

-- Lookup del token en cada subida: debe ser único y rápido.
CREATE UNIQUE INDEX IF NOT EXISTS foto_borrador_token_hash_idx
  ON foto_borrador(token_hash);
-- Tope de borradores activos por usuario.
CREATE INDEX IF NOT EXISTS foto_borrador_user_idx
  ON foto_borrador(user_id, revoked_at, expires_at);
-- Barrido del job de limpieza.
CREATE INDEX IF NOT EXISTS foto_borrador_created_idx
  ON foto_borrador(created_at);

CREATE TABLE IF NOT EXISTS foto_borrador_item (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  borrador_id TEXT NOT NULL REFERENCES foto_borrador(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE foto_borrador_item IS
  'Foto en staging. Se borra al crear la orden (las fotos viajan por el payload actual) o por el job de limpieza a las 24h.';

CREATE INDEX IF NOT EXISTS foto_borrador_item_borrador_idx
  ON foto_borrador_item(borrador_id);

ALTER TABLE foto_borrador ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS foto_borrador_select ON foto_borrador;
CREATE POLICY foto_borrador_select ON foto_borrador
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS foto_borrador_all_service ON foto_borrador;
CREATE POLICY foto_borrador_all_service ON foto_borrador
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE foto_borrador_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS foto_borrador_item_select ON foto_borrador_item;
CREATE POLICY foto_borrador_item_select ON foto_borrador_item
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM foto_borrador b
      WHERE b.id = foto_borrador_item.borrador_id
        AND b.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS foto_borrador_item_all_service ON foto_borrador_item;
CREATE POLICY foto_borrador_item_all_service ON foto_borrador_item
  FOR ALL USING (true) WITH CHECK (true);
