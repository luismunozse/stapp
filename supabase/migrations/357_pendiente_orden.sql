-- Migration 357: pendiente de la orden con una sola formula en SQL.
--
-- Spec: docs/superpowers/specs/2026-10-07-notas-de-credito-design.md
--       ("Pendiente de la orden, fuente unica")
-- Plan: docs/superpowers/plans/2026-10-07-notas-credito-pr1-bases.md (PR1d)
-- Requiere la 350 (notas_credito.monto_aplicado_deuda), la 345
-- (total_cobrado_orden) y la 318 (get_deuda_cliente_sucursal).
--
--   pendiente = costo_final - descuento_cobro - total_cobrado
--             - suma de notas_credito.monto_aplicado_deuda de las NC activas
--
-- Hoy ninguna NC escribe monto_aplicado_deuda (default 0 desde la 350), asi
-- que todo da EXACTAMENTE lo mismo que antes (probes 1 a 3 y 6 a 9). Cuando el
-- motor de ordenes reparta una NC entre deuda y reintegro, el pendiente, el
-- estado de cobro y la deuda del cliente ya la descuentan.
--
-- Parte de los cuerpos VIGENTES, no de los que cita el plan:
--
--   recalcular_estado_cobro: el de la 345, no el de la 068. total_cobrado sigue
--   siendo total_cobrado_orden(), es decir GREATEST(cobros_orden no anulados,
--   pagos_parciales de la factura no anulada). Es plata RECIBIDA y no incluye
--   las NC. Quitar el GREATEST (como decia el plan: "solo cobros_orden") pisaria
--   la correccion de la 345: la sena espejada en los dos libros se perderia y
--   las ordenes con el pago cargado dos veces se leerian mal. Lo unico que se
--   agrega es que el estado de cobro cuenta como cubierto
--   total_cobrado + lo que bajaron las NC (v_cubierto). El lock de la orden, la
--   firma, la ausencia de SECURITY DEFINER y los triggers de la 277 y la 345
--   quedan como estan.
--
--   get_deuda_cliente_sucursal: el de la 318, sin tocar nada salvo la cuenta de
--   cada orden, que pasa de la formula inline a pendiente_orden(). Se conserva
--   el no-doble-conteo de la 318 (una orden con CARGO en cuenta corriente sale
--   de deuda_ordenes, revertido o no), el filtro de estado de la 273
--   (REPARADO/ENTREGADO), SECURITY DEFINER, search_path y los permisos.
--
-- Las dos funciones nuevas son SECURITY INVOKER (RLS aplica) y quedan con los
-- permisos por defecto, como recalcular_estado_cobro y total_cobrado_orden:
-- recalcular_estado_cobro las llama tambien desde los triggers de la 277 y la
-- 345, que corren con el rol de quien hace el cambio.
--
-- Sin foreign keys nuevas: borrar una organizacion no cambia.
--
-- Fuera de alcance (copias de la formula que siguen como estaban, hasta el PR5):
-- v_clientes_resumen.deuda_pendiente (348), registrar_cobros_orden_atomica y
-- demas. Con NC en 0 dan lo mismo que esta migracion.
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion y por
-- default la revierte. Un BEGIN aca haria que `npm run db:dry` lo ejecute tal
-- cual y lo COMMITEE.

-- ── 1. Lo que bajaron las NC activas de una orden ──────────────────────────
CREATE OR REPLACE FUNCTION nc_aplicado_deuda_orden(p_orden_id TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(nc.monto_aplicado_deuda), 0)
  FROM notas_credito nc
  WHERE nc.orden_id = p_orden_id
    AND nc.anulada = false
$$;

COMMENT ON FUNCTION nc_aplicado_deuda_orden(TEXT) IS
  'Lo que bajaron el pendiente de la orden sus notas de credito activas. Migracion 357.';

-- ── 2. Pendiente de la orden (crudo, sin recortar en 0) ────────────────────
CREATE OR REPLACE FUNCTION pendiente_orden(p_orden_id TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(o.costo_final, 0)
       - COALESCE(o.descuento_cobro, 0)
       - COALESCE(o.total_cobrado, 0)
       - nc_aplicado_deuda_orden(o.id)
  FROM ordenes_servicio o
  WHERE o.id = p_orden_id
$$;

COMMENT ON FUNCTION pendiente_orden(TEXT) IS
  'Pendiente de cobro de la orden, sin recortar en 0. Espejo TS: pendienteOrden() '
  'en lib/ordenes/pendiente.ts. Migracion 357.';

-- ── 3. recalcular_estado_cobro (345) con las NC como cubierto ──────────────
-- Mismo cuerpo que la 345. No llama a pendiente_orden() porque es la funcion
-- que refresca total_cobrado: ahi la columna todavia tiene el valor viejo.
-- total_cobrado sigue siendo plata recibida (regla GREATEST de la 345).
CREATE OR REPLACE FUNCTION recalcular_estado_cobro(p_orden_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_total_cobrado DECIMAL;
  v_costo_final DECIMAL;
  v_descuento DECIMAL;
  v_cubierto DECIMAL;
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
  v_cubierto := v_total_cobrado + nc_aplicado_deuda_orden(p_orden_id);

  IF v_costo_final <= 0 THEN
    v_estado := 'PENDIENTE';
  ELSIF v_cubierto >= v_costo_final THEN
    v_estado := 'COBRADO';
  ELSIF v_cubierto > 0 THEN
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

-- ── 4. get_deuda_cliente_sucursal (318) con pendiente_orden() ──────────────
-- Identica a la 318 salvo la cuenta de cada orden. El bloque REVOKE/GRANT se
-- repite tal cual: la funcion es SECURITY DEFINER e ignora RLS, y sin el
-- REVOKE cualquier anon key (va en el bundle del navegador) leeria la deuda de
-- cualquier cliente de cualquier taller por PostgREST.
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
    SELECT COALESCE(SUM(GREATEST(pendiente_orden(o.id), 0)), 0) AS monto
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
  'referencia_tipo=ORDEN) is excluded from deuda_ordenes - reverted or not - '
  'so the same money is never counted twice. Supersedes migration 273. '
  'Migracion 357: deuda_ordenes usa pendiente_orden() (descuenta las NC activas).';
