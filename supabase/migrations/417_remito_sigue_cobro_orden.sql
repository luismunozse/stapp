-- ============================================================================
-- 417: el remito de una orden refleja lo cobrado en la orden
-- ============================================================================
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el codigo. Sin la migracion el
-- codigo nuevo igual funciona (el pago desde el remito se anota como cobro de
-- la orden), pero el remito no se entera y sigue mostrando saldo pendiente.
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/417_...sql
-- (dry-run por defecto, --apply para confirmar). Sin BEGIN/COMMIT a proposito:
-- el runner envuelve el archivo en una transaccion.
--
-- PROBLEMA
-- Cobrar una orden (cobros_orden) y pagar su remito (pagos_parciales) son dos
-- libros. La 345 hizo que el pago del remito cuente en la orden, pero no al
-- reves: facturas.monto_abonado solo sumaba los pagos hechos DESDE el remito.
-- Una orden cobrada antes o despues de generar el remito dejaba el remito en
-- PENDIENTE con "Registrar pago" a la vista, y registrar ese pago cargaba la
-- misma plata dos veces en caja. En prod (2026-11-19): 4 remitos PENDIENTE de
-- ordenes COBRADO y 2 con la sena cobrada en la orden y el remito en 0.
--
-- REGLA (la orden manda)
--   monto_abonado = total del remito          si la orden esta COBRADO
--                 = LEAST(total, total_cobrado) si no
--   estado_pago   = PAGADO / PAGADO_PARCIAL / PENDIENTE segun ese monto.
-- total_cobrado ya es total_cobrado_orden() (345/360): incluye los pagos
-- viejos hechos desde el remito, asi que ningun remito pagado baja.
-- La rama COBRADO cubre el remito con IVA ADITIVO, cuyo total supera el neto
-- de la orden (hoy 0 casos).
-- No se tocan remitos ANULADA ni remitos con total <= 0 (hay 3 en PAGADO con
-- total 0: la regla los pasaria a PENDIENTE sin motivo).
--
-- DESDE EL CODIGO: /api/pagos ahora anota el pago del remito como cobro de la
-- orden (registrar_cobros_orden_atomica). Un solo libro para la plata nueva;
-- este trigger lleva el resultado al remito.
--
-- RECURSION: termina. sincronizar_remito_orden cambia facturas.estado_pago ->
-- facturas_estado_recalcular_cobro (345) -> recalcular_estado_cobro, que
-- recalcula lo mismo (ni cobros_orden ni pagos_parciales cambiaron) -> el
-- trigger nuevo de ordenes_servicio no dispara porque su WHEN exige que
-- total_cobrado o estado_cobro cambien.
--
-- LOCKS: el camino nuevo bloquea orden -> factura (el cobro bloquea la orden y
-- este trigger escribe la factura). Es el orden que la 345 recomendaba.
--
-- SIN DINERO NUEVO: no inserta en cobros_orden, pagos_parciales,
-- movimientos_caja ni cuenta_corriente. Solo campos del remito.
--
-- ----------------------------------------------------------------------------
-- DRY-RUN (antes de aplicar; esperado 2026-11-19: 6 filas, todas suben):
--
--   SELECT f.id, f.estado_pago, f.monto_abonado, f.total,
--          CASE WHEN o.estado_cobro = 'COBRADO' THEN f.total
--               ELSE LEAST(f.total, COALESCE(o.total_cobrado, 0)) END AS nuevo
--     FROM facturas f JOIN ordenes_servicio o ON o.id = f.orden_id
--    WHERE f.estado_pago::text <> 'ANULADA' AND f.total > 0
--      AND COALESCE(f.monto_abonado, 0) <>
--          CASE WHEN o.estado_cobro = 'COBRADO' THEN f.total
--               ELSE LEAST(f.total, COALESCE(o.total_cobrado, 0)) END;
--
-- VERIFICACION POSTERIOR: la misma consulta devuelve 0 filas, y
--   SELECT tgname FROM pg_trigger
--    WHERE tgname IN ('ordenes_servicio_sincroniza_remito', 'facturas_alta_sincroniza_remito');
-- devuelve 2 filas.
-- ----------------------------------------------------------------------------

-- 1. Lleva lo cobrado de la orden a su remito.
CREATE OR REPLACE FUNCTION sincronizar_remito_orden(p_orden_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_filas INTEGER;
BEGIN
  WITH calc AS (
    SELECT f.id,
           CASE WHEN o.estado_cobro = 'COBRADO' THEN f.total
                ELSE LEAST(f.total, GREATEST(COALESCE(o.total_cobrado, 0), 0)) END AS abonado,
           f.total
      FROM facturas f
      JOIN ordenes_servicio o ON o.id = f.orden_id
     WHERE f.orden_id = p_orden_id
       AND f.estado_pago::text <> 'ANULADA'
       AND f.total > 0
  ), nuevo AS (
    SELECT id, abonado,
           CASE WHEN abonado >= total THEN 'PAGADO'
                WHEN abonado > 0      THEN 'PAGADO_PARCIAL'
                ELSE                       'PENDIENTE' END AS estado
      FROM calc
  )
  UPDATE facturas f
     SET monto_abonado = n.abonado,
         estado_pago   = n.estado::estado_pago
    FROM nuevo n
   WHERE f.id = n.id
     AND (COALESCE(f.monto_abonado, 0) IS DISTINCT FROM n.abonado
          OR f.estado_pago::text IS DISTINCT FROM n.estado);

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sincronizar_remito_orden(TEXT) IS
  'Remito de la orden = lo cobrado en la orden (total si COBRADO, si no LEAST(total, total_cobrado)). Ver migracion 417.';

-- 2. Cada vez que cambia lo cobrado de la orden (cobro, anulacion, pago de
--    remito viejo, cambio de costo), el remito se actualiza.
CREATE OR REPLACE FUNCTION trg_ordenes_sincroniza_remito()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sincronizar_remito_orden(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ordenes_servicio_sincroniza_remito ON ordenes_servicio;
CREATE TRIGGER ordenes_servicio_sincroniza_remito
  AFTER UPDATE OF total_cobrado, estado_cobro ON ordenes_servicio
  FOR EACH ROW
  WHEN (OLD.total_cobrado IS DISTINCT FROM NEW.total_cobrado
        OR OLD.estado_cobro IS DISTINCT FROM NEW.estado_cobro)
  EXECUTE FUNCTION trg_ordenes_sincroniza_remito();

-- 3. Al generar el remito ya nace con lo cobrado en la orden.
CREATE OR REPLACE FUNCTION trg_facturas_alta_sincroniza_remito()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sincronizar_remito_orden(NEW.orden_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facturas_alta_sincroniza_remito ON facturas;
CREATE TRIGGER facturas_alta_sincroniza_remito
  AFTER INSERT ON facturas
  FOR EACH ROW
  WHEN (NEW.orden_id IS NOT NULL)
  EXECUTE FUNCTION trg_facturas_alta_sincroniza_remito();

-- 4. Backfill de los remitos existentes.
DO $$
DECLARE
  v_total INTEGER := 0;
  v_orden TEXT;
BEGIN
  FOR v_orden IN
    SELECT DISTINCT orden_id FROM facturas
     WHERE orden_id IS NOT NULL AND estado_pago::text <> 'ANULADA'
  LOOP
    v_total := v_total + sincronizar_remito_orden(v_orden);
  END LOOP;
  RAISE NOTICE 'remitos_sincronizados = %', v_total;
END;
$$;
