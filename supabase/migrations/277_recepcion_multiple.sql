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

-- ============================================================================
-- Contador atómico de `numero` para recepciones
-- ============================================================================
-- `recepciones.numero` tiene UNIQUE(organization_id, numero) pero ninguna
-- forma segura de generarse: dos terminales de mostrador de la misma
-- organización (nota: sucursal_id NO forma parte de la unicidad a propósito,
-- así que dos sucursales de una misma org también compiten por el mismo
-- número) que reciben equipos al mismo tiempo no pueden resolver el próximo
-- número con un simple SELECT MAX(numero) + 1 sin pisarse. Se sigue el mismo
-- mecanismo de contador atómico por organización que ya existe para órdenes,
-- cotizaciones y facturas.

ALTER TABLE organization_counters
  ADD COLUMN IF NOT EXISTS next_recepcion_number INTEGER DEFAULT 1;

CREATE OR REPLACE FUNCTION get_next_recepcion_number(org_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
  max_existing INTEGER;
BEGIN
  -- Obtener el máximo numero existente para esta organización
  SELECT COALESCE(MAX(numero), 0) INTO max_existing
  FROM recepciones
  WHERE organization_id = org_id;

  -- Atomically increment and return: el UPDATE toma row lock sobre el
  -- contador de la organización, así que llamadas concurrentes se
  -- serializan en vez de competir por el mismo número.
  UPDATE organization_counters
  SET next_recepcion_number = GREATEST(next_recepcion_number, max_existing + 1) + 1
  WHERE organization_id = org_id
  RETURNING next_recepcion_number - 1 INTO next_num;

  -- Si no existe el contador para esta organización, crearlo sincronizado
  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_recepcion_number)
    VALUES (org_id, max_existing + 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_recepcion_number = GREATEST(organization_counters.next_recepcion_number, max_existing + 1) + 1
    RETURNING next_recepcion_number - 1 INTO next_num;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Feature flag: Profesional y Pro
UPDATE plans SET
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"recepcion_multiple": true}'::jsonb,
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
