-- Rollback de 295_datos_fiscales_cobro_organizations.sql
--
-- Restaura el estado previo: quita los 6 campos fiscales/de cobro agregados
-- a organizations y vuelve a dejar anular_factura_atomica con wording de
-- "factura" (verbatim de la migración 292 — ojo: eso reintroduce el
-- descalce de género con la respuesta del route, que ya devuelve
-- "Remito no encontrado" / "El remito ya está anulado" al cliente; el
-- fallback de mapeo de errores del route también debe revertirse junto con
-- este archivo si se hace rollback completo de la 295).

ALTER TABLE organizations
  DROP COLUMN IF EXISTS cuit,
  DROP COLUMN IF EXISTS condicion_iva,
  DROP COLUMN IF EXISTS domicilio_fiscal,
  DROP COLUMN IF EXISTS cbu_alias,
  DROP COLUMN IF EXISTS medios_pago_texto,
  DROP COLUMN IF EXISTS plazo_pago_dias;

-- ============================================================
-- anular_factura_atomica — restaurado verbatim de la migración 292
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
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'La factura ya esta anulada';
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
  'whichever origin is populated. Migration 248/269 base behavior preserved.';
