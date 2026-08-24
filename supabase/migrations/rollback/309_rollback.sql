-- Rollback de la migracion 309.
--
-- Restaura get_deuda_cliente_sucursal al cuerpo de la migracion 267, verbatim
-- (incluido el bloque REVOKE/GRANT). OJO: esto reintroduce el bug de doble
-- conteo que 309 arregla — una orden entregada con fiado vuelve a sumar tanto
-- en deuda_fiado (via cuenta_corriente) como en deuda_ordenes (via
-- ordenes_servicio), porque se saca el NOT EXISTS que las hace excluyentes.
-- No hay perdida de datos: la funcion es SECURITY DEFINER de solo lectura,
-- este rollback solo cambia que consulta hace.

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
    fiado.monto              AS deuda_fiado,
    ordenes.monto             AS deuda_ordenes,
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
      AND (p_sucursal_id IS NULL OR o.sucursal_id = p_sucursal_id)
  ) ordenes;
$$;

-- ============================================================
-- RPC sensible — REVOKE de PUBLIC/anon/authenticated
-- ============================================================
-- Solo se invoca desde app/api/clientes/[id]/deuda-sucursal/route.ts vía
-- supabaseAdmin (service_role). Sin este REVOKE, cualquier anon/authenticated
-- key podría invocarla directo por PostgREST y leer la deuda de cualquier
-- cliente de cualquier organización (SECURITY DEFINER corre con privilegios
-- del owner, ignora RLS).
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) IS
  'Per-branch combined debt (fiado + unpaid ordenes) for one cliente. '
  'p_sucursal_id NULL = sum across all branches (ADMIN verTodas). '
  'fiado = GREATEST(-SUM(cuenta_corriente.monto), 0) filtered by sucursal_id; '
  'ordenes = SUM(GREATEST(costo_final-descuento_cobro-total_cobrado,0)) over '
  'ordenes_servicio where estado_cobro IN (PENDIENTE,PARCIAL), filtered by sucursal_id. '
  'KNOWN GAP: cuenta_corriente.sucursal_id is only populated for DEPOSITO rows '
  '(mig 238); CARGO/USO/PAGO/DEVOLUCION writers do not persist it, so branch-scoped '
  'fiado may read as understated until a follow-up migration closes that gap. '
  'Idempotent CREATE OR REPLACE. Migration 267.';
