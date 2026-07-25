-- ============================================================================
-- 277: recepción múltiple en mostrador
-- ============================================================================
-- Un cliente deja N equipos en una sola atención: se crea una orden por equipo
-- agrupadas bajo un comprobante de recepción con UNA firma.
--
-- `recepciones` es un DOCUMENTO, no una entidad con ciclo de vida: por eso no
-- tiene columna `estado`. Esa ausencia es la garantía estructural de que esta
-- feature nunca toca la máquina de estados de la orden — el ciclo de vida
-- sigue siendo 100% por orden. Si en el futuro alguien siente la tentación de
-- agregar `estado` acá, el diseño se rompió.
--
-- `ordenes_servicio.recepcion_id` es nullable con índice PARCIAL
-- (WHERE recepcion_id IS NOT NULL): el flujo clásico (una orden por equipo)
-- deja NULL — es la abrumadora mayoría de las filas — y el índice parcial
-- hace que ese flujo no pague costo de escritura ni de espacio. Ninguna
-- query de negocio puede asumir que la columna está poblada.
--
-- La FK usa ON DELETE SET NULL, nunca CASCADE: borrar un comprobante de
-- recepción no puede arrastrar las órdenes que tienen los equipos reales
-- del cliente.
--
-- RLS: se sigue la convención vigente de 274_asistente_panel.sql
-- (current_setting('app.organization_id', true) para SELECT + policy de
-- servicio permisiva), no el patrón viejo con auth.uid() de
-- 067_cobros_orden_caja.sql. La app accede con service role
-- (supabaseAdmin), así que esta RLS es defensa en profundidad.
-- ============================================================================

CREATE TABLE IF NOT EXISTS recepciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT REFERENCES sucursales(id),
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  firma_cliente TEXT,
  firma_mime TEXT,
  terminos_aceptados BOOLEAN NOT NULL DEFAULT FALSE,
  recibido_por TEXT REFERENCES users(id),
  observaciones TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(organization_id, numero)
);

CREATE INDEX IF NOT EXISTS recepciones_org_created_idx
  ON recepciones(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recepciones_cliente_idx
  ON recepciones(organization_id, cliente_id);

ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recepciones_select ON recepciones;
CREATE POLICY recepciones_select ON recepciones
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS recepciones_all_service ON recepciones;
CREATE POLICY recepciones_all_service ON recepciones
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE recepciones IS
  'Comprobante de recepción de N equipos del mismo cliente en una atención. Documento, no entidad con ciclo de vida: sin columna estado a propósito.';

-- Vínculo opcional desde la orden
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recepcion_id TEXT REFERENCES recepciones(id) ON DELETE SET NULL;

-- Índice PARCIAL: cero costo para el flujo clásico
CREATE INDEX IF NOT EXISTS ordenes_recepcion_idx
  ON ordenes_servicio(recepcion_id)
  WHERE recepcion_id IS NOT NULL;

COMMENT ON COLUMN ordenes_servicio.recepcion_id IS
  'Lote de recepción múltiple, NULL en el alta clásica. Nunca asumir que existe.';

-- Feature flag: Profesional y Pro
UPDATE plans SET
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"recepcion_multiple": true}'::jsonb,
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
