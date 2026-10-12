-- 295: fiscal identity + collection data for organizations, and remito wording in RPC errors
-- Number finalized at merge time (294 is claimed by open PR #283).
--
-- Part 1: adds the fields the remito PDF (lib/pdf.ts, RC Task 2/3) already
-- knows how to render — cuitEmpresa/condicionIvaEmpresa/domicilioFiscalEmpresa/
-- mediosPago/cbuAlias — plus plazo_pago_dias, which RC Task 6 wires up: the
-- fiscal-data config screen persists it, and the remito PDF route computes
-- vencimiento = fecha de emisión + plazo_pago_dias when it's set. All
-- nullable: an org that hasn't filled these in yet gets the exact same PDF
-- it gets today (every block in lib/pdf.ts is conditional on the field
-- being present).
--
-- Part 2: re-creates anular_factura_atomica with "remito" wording in its
-- user-facing RAISE EXCEPTION strings, verbatim otherwise from migration 292
-- (the latest CREATE OR REPLACE — 248 added the guard, 269 threaded
-- sucursal_id, 292 switched the org/cliente/sucursal lookup to a LEFT JOIN
-- over both ordenes_servicio and ventas so venta-sourced facturas work too).
-- Changed messages:
--   'Factura no encontrada'      -> 'Remito no encontrado'
--   'La factura ya esta anulada' -> 'El remito ya esta anulado'
-- 'No autorizado' is untouched (not factura/remito-specific).
--
-- Route-side note (app/api/facturacion/[id]/route.ts, handleAnularFactura):
-- the gender changed (encontrada -> encontrado, anulada -> anulado). The
-- route matches this RPC's error message with gender-agnostic regexes
-- (/no encontrad[oa]/, /ya esta anulad[oa]/) so it accepts both wordings —
-- this migration and that route don't need to deploy atomically, and the
-- rollback (supabase/migrations/rollback/295_rollback.sql) doesn't need a
-- matching route revert either.
-- eliminar_factura_atomica is NOT touched by this migration and still raises
-- 'Factura no encontrada', so its own match at line ~449 stays as-is.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS cuit TEXT,
  ADD COLUMN IF NOT EXISTS condicion_iva TEXT,
  ADD COLUMN IF NOT EXISTS domicilio_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS cbu_alias TEXT,
  ADD COLUMN IF NOT EXISTS medios_pago_texto TEXT,
  ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER;

COMMENT ON COLUMN organizations.cuit IS
  'CUIT (Clave Única de Identificación Tributaria) del emisor, impreso en el remito. Nullable: sin CUIT cargado, el bloque simplemente no se imprime (lib/pdf.ts).';
COMMENT ON COLUMN organizations.condicion_iva IS
  'Condición frente al IVA del emisor (ej. "Responsable Inscripto", "Monotributo", "Exento"), texto libre impreso en el remito.';
COMMENT ON COLUMN organizations.domicilio_fiscal IS
  'Domicilio fiscal del emisor, impreso en el remito junto al CUIT y la condición de IVA.';
COMMENT ON COLUMN organizations.cbu_alias IS
  'CBU o alias bancario del emisor para cobros por transferencia, impreso en el bloque de condiciones de pago del remito.';
COMMENT ON COLUMN organizations.medios_pago_texto IS
  'Texto libre con los medios de pago aceptados (ej. "Efectivo, transferencia, tarjeta"), impreso junto al CBU/alias en el remito.';
COMMENT ON COLUMN organizations.plazo_pago_dias IS
  'Plazo de pago en días (net terms) del emisor, configurable en la pantalla de datos fiscales (RC Task 6). Consumido por el remito para calcular vencimiento = fecha de emisión + este plazo; nullable, un remito sin plazo cargado simplemente no muestra vencimiento.';

-- ============================================================
-- anular_factura_atomica — verbatim from migration 292, remito wording only
-- ============================================================
CREATE OR REPLACE FUNCTION anular_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  SELECT
    f.*,
    f.organization_id AS org_id,
    COALESCE(o.cliente_id, v.cliente_id) AS cliente_id,
    COALESCE(o.sucursal_id, v.sucursal_id) AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    LEFT JOIN ordenes_servicio o ON o.id = f.orden_id
    LEFT JOIN ventas v ON v.id = f.venta_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Remito no encontrado';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'El remito ya esta anulado';
  END IF;

  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Anulacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  UPDATE facturas
    SET estado_pago = 'ANULADA'::estado_pago
    WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_factura_atomica(TEXT,TEXT,TEXT) IS
  'Voids a factura atomically. Guards: not-found, org mismatch, already-ANULADA. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente. '
  'Sets estado_pago=ANULADA. org_id/cliente_id/sucursal_id resolved via LEFT '
  'JOIN to both ordenes_servicio and ventas (migration 292) — org_id reads '
  'facturas.organization_id directly; cliente_id/sucursal_id fall back to '
  'whichever origin is populated. Migration 248/269 base behavior preserved. '
  'Migration 295: RAISE EXCEPTION strings now use remito wording '
  '(''Remito no encontrado'' / ''El remito ya esta anulado'') instead of '
  'factura wording — body otherwise verbatim from migration 292.';
