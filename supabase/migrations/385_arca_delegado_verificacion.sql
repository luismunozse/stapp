-- ============================================================================
-- 385: verificación de la delegación ARCA por la plataforma
-- ============================================================================
-- En el modelo delegado (325) cada taller delega el servicio de facturación al
-- CUIT de STApp en ARCA, y la fila del taller solo declara su CUIT. ARCA
-- autoriza a STApp a facturar por TODOS los CUIT que le delegaron, así que el
-- CUIT declarado por una org tiene que ser verificado por la plataforma antes
-- de usarse.
--
-- Qué cambia:
--   * estado admite 'pendiente_verificacion'. La ruta de credenciales deja ahí
--     toda delegación nueva o con CUIT distinto; un superadmin la pasa a
--     'conectado' desde el panel (/superadmin/organizaciones/[id]).
--     resolverCredenciales y canEmitirFacturaElectronica exigen 'conectado'.
--   * Un CUIT delegado pertenece a una sola org: índice único parcial.
--
-- Las filas delegadas existentes quedan como están ('conectado'). Antes de
-- aplicar, revisarlas con verify/385_probes.sql: si alguna org tiene un CUIT
-- que no es suyo, pasarla a 'pendiente_verificacion' a mano.
--
-- Si ya hay un CUIT delegado en más de una org la migración aborta con el
-- detalle: eso hay que resolverlo (y entender cómo pasó) antes de seguir.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  v_dup TEXT;
BEGIN
  SELECT string_agg(format('%s (orgs: %s)', cuit, orgs), '; ')
    INTO v_dup
  FROM (
    SELECT cuit, string_agg(organization_id, ', ' ORDER BY organization_id) AS orgs
    FROM facturacion_credenciales
    WHERE provider = 'arca_delegado'
    GROUP BY cuit
    HAVING count(*) > 1
  ) d;

  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION '385: hay CUIT delegados en más de una organización: %', v_dup;
  END IF;
END $$;

ALTER TABLE facturacion_credenciales DROP CONSTRAINT IF EXISTS facturacion_credenciales_estado_check;
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_estado_check
  CHECK (estado IN ('conectado', 'error', 'cert_vencido', 'sin_configurar', 'pendiente_verificacion'));

CREATE UNIQUE INDEX IF NOT EXISTS facturacion_credenciales_cuit_delegado_uniq
  ON facturacion_credenciales (cuit)
  WHERE provider = 'arca_delegado';

COMMENT ON COLUMN facturacion_credenciales.estado IS
  'conectado | error | cert_vencido | sin_configurar | pendiente_verificacion. En arca_delegado solo se emite con conectado, que asigna un superadmin tras verificar el CUIT (385).';
