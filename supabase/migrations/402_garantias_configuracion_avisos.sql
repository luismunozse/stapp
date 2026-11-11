-- Garantías: términos de la org, ventana "por vencer" configurable y aviso al
-- cliente antes del vencimiento.
--
-- Fase 3 de docs/garantias-flujo-2026-11-11.md (decisiones 5 y 6 del dueño:
-- ventana de 7 días configurable; aviso opcional, apagado por defecto).
--
-- 1. organizations
--    - garantia_terminos: texto de la org que se imprime en el comprobante de
--      entrega y en el certificado de garantía de venta. NULL = sin términos
--      propios. Tope de 2000 caracteres (CHECK) para que entre en el papel.
--    - garantia_ventana_por_vencer_dias: días de la pestaña "Por vencer" de
--      /garantias, la tarjeta del dashboard y el aviso al cliente. 7 por
--      defecto, entre 1 y 90 (el mismo tope que lib/garantias/estado.ts).
--    - garantia_aviso_vencimiento: si el cron avisa al cliente cuando su
--      garantía entra en la ventana. FALSE por defecto.
--    Agregar columnas NOT NULL con DEFAULT constante no reescribe la tabla.
--
-- 2. aviso_vencimiento_enviado_at en garantias y garantias_venta
--    Marca de idempotencia del aviso: el cron la escribe con un UPDATE
--    condicional (... WHERE aviso_vencimiento_enviado_at IS NULL) ANTES de
--    encolar, así dos corridas en paralelo no avisan dos veces. NULL en todas
--    las filas existentes. v_garantias no cambia: el cron la lee de las tablas.
--
-- 3. tipo_notificacion
--    - GARANTIA_POR_VENCER: el tipo nuevo del aviso.
--    - REINGRESO_GARANTIA: la fase 2 empezó a encolarlo pero el enum nunca lo
--      tuvo, así que el insert en notification_logs fallaba (el mensaje salía
--      y no quedaba registrado). Se agrega acá.
--    ALTER TYPE ... ADD VALUE corre dentro de una transacción desde PG 12; el
--    valor nuevo recién se puede USAR después del COMMIT (esta migración no lo
--    usa). No hay vuelta atrás: Postgres no borra valores de un enum.
--
-- Sin grants nuevos: organizations, garantias y garantias_venta ya se leen con
-- service_role. Idempotente: se puede correr más de una vez.
-- Rollback: rollback/402_rollback.sql. Verificación: verify/402_probes.sql.

SET LOCAL lock_timeout = '3s';

-- ── 1. Configuración de garantías de la org ────────────────────────────────

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS garantia_terminos TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS garantia_ventana_por_vencer_dias INTEGER NOT NULL DEFAULT 7;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS garantia_aviso_vencimiento BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_garantia_terminos_largo'
                  AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_garantia_terminos_largo
      CHECK (garantia_terminos IS NULL OR char_length(garantia_terminos) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_garantia_ventana_rango'
                  AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_garantia_ventana_rango
      CHECK (garantia_ventana_por_vencer_dias BETWEEN 1 AND 90);
  END IF;
END $$;

COMMENT ON COLUMN organizations.garantia_terminos IS
  'Términos de garantía de la org: se imprimen en el comprobante de entrega y en el certificado de venta (402).';
COMMENT ON COLUMN organizations.garantia_ventana_por_vencer_dias IS
  'Días de la ventana "por vencer" de /garantias, el dashboard y el aviso al cliente (402).';
COMMENT ON COLUMN organizations.garantia_aviso_vencimiento IS
  'Si el cron garantias-por-vencer avisa al cliente antes del vencimiento (402). Apagado por defecto.';

-- ── 2. Marca de aviso enviado ──────────────────────────────────────────────

ALTER TABLE garantias ADD COLUMN IF NOT EXISTS aviso_vencimiento_enviado_at TIMESTAMPTZ;
ALTER TABLE garantias_venta ADD COLUMN IF NOT EXISTS aviso_vencimiento_enviado_at TIMESTAMPTZ;

COMMENT ON COLUMN garantias.aviso_vencimiento_enviado_at IS
  'Cuándo se avisó al cliente que la garantía está por vencer. NULL = no se avisó (402).';
COMMENT ON COLUMN garantias_venta.aviso_vencimiento_enviado_at IS
  'Cuándo se avisó al cliente que la garantía está por vencer. NULL = no se avisó (402).';

-- ── 3. Tipos de notificación ───────────────────────────────────────────────

ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'REINGRESO_GARANTIA';
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'GARANTIA_POR_VENCER';
