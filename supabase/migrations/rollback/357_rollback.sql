-- Rollback de la 357. No pierde datos. Vuelve recalcular_estado_cobro al cuerpo
-- de la 345 (total_cobrado = GREATEST de cobros_orden y pagos de la factura) y
-- get_deuda_cliente_sucursal al de la 318, y borra las dos funciones nuevas.
-- No vuelve a la 068: eso reabriria el doble cobro que corrigio la 345.
-- total_cobrado_orden y los triggers de la 345 no se tocan.
-- El codigo del PR1e no llama a estas funciones: no hace falta revertirlo antes.
--
-- Las ordenes que una NC con monto_aplicado_deuda > 0 haya dejado COBRADO
-- (hoy ninguna) conservan ese estado hasta su proximo recalculo.

CREATE OR REPLACE FUNCTION get_deuda_cliente_sucursal(
  p_org_id      TEXT,
  p_cliente_id  TEXT,
  p_sucursal_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  deuda_fiado   NUMERIC,
  deuda_ordenes NUMERIC,
  deuda_total   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fiado.monto                 AS deuda_fiado,
    ordenes.monto               AS deuda_ordenes,
    fiado.monto + ordenes.monto AS deuda_total
  FROM (
    SELECT GREATEST(-COALESCE(SUM(cc.monto), 0), 0) AS monto
    FROM cuenta_corriente cc
    WHERE cc.organization_id = p_org_id
      AND cc.cliente_id = p_cliente_id
      AND (p_sucursal_id IS NULL OR cc.sucursal_id = p_sucursal_id)
  ) fiado,
  (
    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
        0
      )
    ), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = p_org_id
      AND o.cliente_id = p_cliente_id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND o.estado IN ('REPARADO', 'ENTREGADO')
      AND (p_sucursal_id IS NULL OR o.sucursal_id = p_sucursal_id)
      AND NOT EXISTS (
        SELECT 1
        FROM cuenta_corriente cc2
        WHERE cc2.organization_id = o.organization_id
          AND cc2.cliente_id      = o.cliente_id
          AND cc2.tipo            = 'CARGO'
          AND cc2.referencia_tipo = 'ORDEN'
          AND cc2.referencia_id   = o.id
      )
  ) ordenes;
$$;

REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) IS
  'Per-branch combined debt (fiado + unpaid ordenes) for one cliente. '
  'p_sucursal_id NULL = sum across all branches (ADMIN verTodas). '
  'An order whose debt already moved to cuenta corriente (CARGO with '
  'referencia_tipo=ORDEN) is excluded from deuda_ordenes — reverted or not — '
  'so the same money is never counted twice. Supersedes migration 273.';

CREATE OR REPLACE FUNCTION recalcular_estado_cobro(p_orden_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_total_cobrado DECIMAL;
  v_costo_final DECIMAL;
  v_descuento DECIMAL;
  v_estado TEXT;
BEGIN
  -- Serializa los recalculos de la misma orden. Sin este lock, un pago de
  -- factura (que solo bloquea la factura) y registrar_cobros_orden_atomica
  -- (que bloquea la orden) podian calcular el total antes de que la otra
  -- transaccion confirmara y el UPDATE mas tardio pisaba al otro (lost update).
  -- Debe ser lo PRIMERO que hace la funcion y la suma va en una sentencia
  -- plpgsql APARTE: en READ COMMITTED cada sentencia toma un snapshot nuevo,
  -- asi que la suma ve lo confirmado mientras esperabamos el lock. No unir las
  -- dos cosas en una sola sentencia SQL.
  PERFORM 1 FROM ordenes_servicio WHERE id = p_orden_id FOR UPDATE;

  v_total_cobrado := total_cobrado_orden(p_orden_id);

  SELECT COALESCE(costo_final, 0), COALESCE(descuento_cobro, 0)
  INTO v_costo_final, v_descuento
  FROM ordenes_servicio WHERE id = p_orden_id;

  v_costo_final := v_costo_final - v_descuento;

  IF v_costo_final <= 0 THEN
    v_estado := 'PENDIENTE';
  ELSIF v_total_cobrado >= v_costo_final THEN
    v_estado := 'COBRADO';
  ELSIF v_total_cobrado > 0 THEN
    v_estado := 'PARCIAL';
  ELSE
    v_estado := 'PENDIENTE';
  END IF;

  UPDATE ordenes_servicio
  SET total_cobrado = v_total_cobrado,
      estado_cobro = v_estado
  WHERE id = p_orden_id;
END;
$$ LANGUAGE plpgsql;

-- Se borran al final: las versiones restauradas de arriba ya no las usan.
DROP FUNCTION IF EXISTS pendiente_orden(TEXT);
DROP FUNCTION IF EXISTS nc_aplicado_deuda_orden(TEXT);
