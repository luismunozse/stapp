-- ============================================================================
-- 287: recepción múltiple en mostrador
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
-- del cliente. Por el mismo criterio, `sucursal_id`, `recibido_por` y
-- `created_by` también son ON DELETE SET NULL: un comprobante firmado tiene
-- que poder sobrevivir a la baja de la sucursal o del usuario que lo tomó,
-- y esa baja no puede quedar bloqueada por un documento histórico (el
-- default de Postgres, NO ACTION, haría fallar el DELETE del usuario).
--
-- RLS: se sigue la decisión vigente de 201_rls_hardening_phase1.sql, NO el
-- patrón de 274_asistente_panel.sql (que es posterior en número pero
-- regresionó contra 201):
--   * la policy de servicio va explícitamente TO service_role. Sin cláusula
--     TO, Postgres la aplica a PUBLIC — que incluye `anon`, y el anon key
--     viaja en el bundle del browser (lib/supabase.ts) → cualquiera podría
--     leer (y con FOR ALL, escribir) las firmas de todos los tenants.
--     Mismo bug que 203_drop_anon_realtime_policies.sql clasificó CRITICAL.
--   * la policy de SELECT usa public.get_current_organization_id() y no
--     current_setting('app.organization_id', true): esa GUC nunca se setea en
--     el request flow normal (ver 201, Change C) y quedaría como patrón roto
--     listo para copiarse. Se conserva la policy (no se dropea) porque eso es
--     exactamente lo que hizo 201 con sus equivalentes.
-- La app accede con service role (supabaseAdmin), así que esta RLS es
-- defensa en profundidad y su impacto en runtime es cero.
--
-- SAFE-UNDER-LOAD GUARD: el ALTER TABLE sobre `ordenes_servicio` toma
-- ACCESS EXCLUSIVE sobre la tabla más caliente del sistema. Agregar una
-- columna nullable sin default es metadata-only, pero si el lock queda
-- encolado detrás de una query larga, TODO request que toque órdenes se
-- encola detrás del ALTER. lock_timeout hace que la transacción ABORTE y
-- ROLLBACKEE limpio a los 3s en vez de frenar tráfico vivo. Si aborta con
-- "canceling statement due to lock timeout" NO SE APLICÓ NADA (es atómico):
-- simplemente volvé a correr el archivo. Todo es IF NOT EXISTS / OR REPLACE,
-- así que re-correrlo es seguro. Preferí igual una ventana de bajo tráfico.
--
-- El índice sobre ordenes_servicio va CONCURRENTLY y por eso queda FUERA de
-- la transacción (Postgres lo prohíbe adentro) — ver la nota al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS recepciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT REFERENCES sucursales(id) ON DELETE SET NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  firma_cliente TEXT,
  firma_mime TEXT,
  terminos_aceptados BOOLEAN NOT NULL DEFAULT FALSE,
  recibido_por TEXT REFERENCES users(id) ON DELETE SET NULL,
  observaciones TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(organization_id, numero)
);

-- Índices de la tabla nueva: van adentro de la transacción sin CONCURRENTLY
-- a propósito. La tabla se acaba de crear en esta misma transacción, está
-- vacía y nadie más la ve todavía: no hay tráfico que bloquear.
CREATE INDEX IF NOT EXISTS recepciones_org_created_idx
  ON recepciones(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recepciones_cliente_idx
  ON recepciones(organization_id, cliente_id);

ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;

-- SELECT org-scoped para `authenticated`, con el helper que lee el claim del
-- JWT (201 Change C + 251: sin claim devuelve NULL → fail-closed).
DROP POLICY IF EXISTS recepciones_select ON recepciones;
CREATE POLICY recepciones_select ON recepciones
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- Catch-all de escritura SOLO para service_role (201 Change B). El TO es la
-- parte que importa: sin él esta policy sería PUBLIC → anon con RW total.
DROP POLICY IF EXISTS recepciones_all_service ON recepciones;
CREATE POLICY recepciones_all_service ON recepciones
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE recepciones IS
  'Comprobante de recepción de N equipos del mismo cliente en una atención. Documento, no entidad con ciclo de vida: sin columna estado a propósito.';

-- Vínculo opcional desde la orden
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recepcion_id TEXT REFERENCES recepciones(id) ON DELETE SET NULL;

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

COMMIT;

-- ============================================================================
-- FUERA DE LA TRANSACCIÓN — índice parcial sobre ordenes_servicio
-- ============================================================================
-- CREATE INDEX (sin CONCURRENTLY) toma un lock que bloquea TODA escritura en
-- ordenes_servicio durante el scan completo de la tabla. CONCURRENTLY no lo
-- hace, pero Postgres prohíbe correrlo dentro de un bloque de transacción:
-- por eso va acá abajo, después del COMMIT, y nunca adentro del BEGIN.
--
-- CÓMO CORRERLO: seleccioná y ejecutá ESTA SENTENCIA SOLA, en una ejecución
-- aparte del bloque de arriba. En un batch multi-sentencia (todo el archivo
-- pegado de una) Postgres la considera dentro de un bloque de transacción
-- implícito y falla con "CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block".
--
-- SI FALLA A MITAD: CONCURRENTLY deja el índice en estado INVALID, y un
-- re-run con IF NOT EXISTS lo saltearía dejándolo inválido para siempre.
-- Ante cualquier error acá, primero:
--     DROP INDEX IF EXISTS ordenes_recepcion_idx;
-- y recién después volvé a correr el CREATE INDEX CONCURRENTLY.
--
-- Índice PARCIAL: cero costo para el flujo clásico (recepcion_id NULL).
CREATE INDEX CONCURRENTLY IF NOT EXISTS ordenes_recepcion_idx
  ON ordenes_servicio(recepcion_id)
  WHERE recepcion_id IS NOT NULL;
