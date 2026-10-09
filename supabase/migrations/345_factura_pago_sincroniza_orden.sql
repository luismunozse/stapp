-- ============================================================================
-- 345: el pago de una factura ahora cuenta en total_cobrado / estado_cobro
-- ============================================================================
-- NUMERO: provisorio. Es definitivo recien al mergear (340 esta aplicada desde
-- el PR #426, 341 la reserva feat/orden-ingreso-trabajo-garantia y 342-344 el
-- plan de notas de credito). Si otra migracion se mergea antes, renumerar.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el codigo. Este PR no cambia
-- codigo de la app; sin la migracion no pasa nada (todo sigue como hoy).
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/345_...sql
-- (dry-run por defecto, --apply para confirmar). Este archivo NO lleva
-- BEGIN/COMMIT a proposito: el runner solo mira las primeras 40 lineas y, si
-- ve un BEGIN, el archivo maneja su transaccion y el "dry-run" confirmaria.
--
-- PROBLEMA
-- Registrar un pago sobre la factura de una orden (/api/pagos ->
-- registrar_pago_factura_atomica, o su fallback JS) escribe pagos_parciales y
-- facturas.monto_abonado, pero NUNCA toca la orden. recalcular_estado_cobro
-- (068:100) deriva total_cobrado SOLO de cobros_orden. Resultado: una orden
-- pagada por factura sigue PENDIENTE; "Cobrar todo" (ordenes-pendientes y
-- get_deuda_cliente_sucursal, mig 318) la cobra de nuevo.
--
-- REGLA (unica, vive en el motor)
--   total_cobrado = GREATEST( SUM(cobros_orden no anulados),
--                             SUM(pagos_parciales de la factura NO anulada) )
-- El estado se compara contra costo_final - descuento_cobro como siempre.
--
-- POR QUE GREATEST Y NO LA SUMA
-- Los dos libros registran en parte el MISMO dinero:
--   - la sena se espeja por diseno: ordenes/route.ts:473 la guarda en
--     cobros_orden al ingreso y crear_factura_atomica (249) la copia a
--     pagos_parciales al facturar;
--   - en produccion 24 de 118 ordenes con factura tienen el pago completo en
--     ambos libros (el operador lo cargo dos veces); en las 24 cobros_orden
--     queda contenido en pagos_parciales.
-- Sumar inflaria esas 24 ordenes al doble y duplicaria cada sena. GREATEST es
-- una cota inferior: nunca marca COBRADO de mas.
--
-- LIMITACION CONOCIDA (agujero documentado)
-- Si se paga PARCIALMENTE la factura (p.ej. 30 de 50) y despues el resto (20)
-- se cobra en la orden, total_cobrado queda en max(20, 30) = 30: la orden
-- sigue mostrando 20 pendientes y se podria cobrar dos veces ese resto. No hay
-- forma de distinguir estructuralmente "mismo dinero cargado dos veces" de
-- "dos pagos distintos". En prod hay 0 casos de este tipo. Las salidas reales
-- son (a) una columna que enlace el espejo, o (b) que el pendiente de la
-- factura descuente los cobros de la orden. Fuera de alcance aca.
--
-- !!! CONFLICTO CON EL PLAN DE NOTAS DE CREDITO (paso 1d, migracion 341 del
-- !!! plan) !!!
-- El paso 1d reescribe recalcular_estado_cobro y get_deuda_cliente_sucursal, y
-- su plan dice "total_cobrado sigue siendo solo cobros_orden". Esa reescritura
-- DEBE conservar la regla GREATEST de esta migracion (usar total_cobrado_orden()
-- o repetir la expresion). Si se aplica despues con el cuerpo viejo, pisa esta
-- correccion en silencio y las ~83 ordenes vuelven a quedar mal en cuanto se
-- recalculen.
--
-- CONCURRENCIA Y ORDEN DE LOCKS
-- recalcular_estado_cobro toma FOR UPDATE sobre la orden antes de sumar. Los
-- pagos de factura ahora toman: factura -> (clientes, si el metodo es CUENTA
-- CORRIENTE) -> orden. registrar_cobros_orden_atomica toma: orden -> clientes.
-- Con cuenta corriente en ambos lados y la MISMA orden/cliente a la vez hay un
-- ciclo posible (deadlock; Postgres aborta una de las dos con 40P01, no se
-- pierde dinero). Ninguna otra ruta bloquea la orden y despues la factura
-- (generar/crear_factura_atomica solo inserta la factura, anular y eliminar
-- parten de la factura, /entregar y los RPC de servicios no tocan facturas).
-- Arreglo de fondo, fuera de esta migracion: que registrar_pago_factura_atomica,
-- anular_factura_atomica y eliminar_factura_atomica tomen la ORDEN primero
-- (FOR UPDATE OF f, o en el SELECT inicial) para unificar el orden orden ->
-- factura -> clientes.
--
-- IMPACTO EN COMISIONES (cambio de comportamiento visible)
-- app/api/comisiones/route.ts:57 lista solo estado_cobro = 'COBRADO'. Medido en
-- prod el 2026-10-09: de los 81 pedidos que pasan a COBRADO, 68 tienen tecnico
-- y entran a v_comisiones_ordenes (REPARADO/ENTREGADO), de 3 organizaciones y 4
-- tecnicos, con fecha_completado entre 2026-02-16 y 2026-03-22 (6 a 8 meses de
-- antiguedad). Los 68 tienen porcentaje_comision = 0, asi que monto_comision
-- total = $0 y ninguna comision pagada: aparecen filas viejas en el listado,
-- sin deuda de comision. 0 dependen del flag comision_aplica_sin_reparacion.
-- Si alguna organizacion fija un porcentaje retroactivo, esas ordenes se pagan.
--
-- RECURSION: ninguna. Los triggers nuevos cuelgan de pagos_parciales y
-- facturas; recalcular_estado_cobro solo hace UPDATE de total_cobrado y
-- estado_cobro en ordenes_servicio, y el trigger de la 277 es
-- AFTER UPDATE OF costo_final, descuento_cobro (ninguna de esas columnas).
--
-- SIN DINERO NUEVO: esta migracion no inserta en cobros_orden, pagos_parciales,
-- movimientos_caja ni cuenta_corriente. Solo recalcula los campos derivados.
--
-- FACTURAS SIN ORDEN (ventas POS, orden_id NULL): los triggers no hacen nada.
--
-- PRIVILEGIOS: sin SECURITY DEFINER, igual que recalcular_estado_cobro (068) y
-- el trigger de la 277. Las escrituras de la app pasan por service_role.
--
-- ----------------------------------------------------------------------------
-- DRY-RUN 1: cuantas filas cambian, agrupadas por estado (esperado en prod el
-- 2026-10-09: PENDIENTE->COBRADO 80, PENDIENTE->PARCIAL 2, PARCIAL->COBRADO 1;
-- total 83). Correr ANTES de aplicar (la funcion nueva todavia no existe, por
-- eso la expresion va inline):
--
--   WITH calc AS (
--     SELECT o.id, o.estado_cobro AS de, COALESCE(o.total_cobrado,0) AS tc_old,
--            COALESCE(o.costo_final,0) - COALESCE(o.descuento_cobro,0) AS neto,
--            GREATEST(
--              COALESCE((SELECT SUM(c.monto) FROM cobros_orden c
--                         WHERE c.orden_id = o.id AND c.anulado = FALSE), 0),
--              COALESCE((SELECT SUM(p.monto) FROM pagos_parciales p
--                          JOIN facturas f ON f.id = p.factura_id
--                         WHERE f.orden_id = o.id
--                           AND f.estado_pago::text <> 'ANULADA'), 0)) AS tc_new
--       FROM ordenes_servicio o
--      WHERE EXISTS (SELECT 1 FROM pagos_parciales p
--                      JOIN facturas f ON f.id = p.factura_id
--                     WHERE f.orden_id = o.id))
--   SELECT de AS desde,
--          CASE WHEN neto <= 0 THEN 'PENDIENTE' WHEN tc_new >= neto THEN 'COBRADO'
--               WHEN tc_new > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END AS hacia,
--          COUNT(*) AS filas
--     FROM calc
--    WHERE tc_new <> tc_old
--       OR de IS DISTINCT FROM CASE WHEN neto <= 0 THEN 'PENDIENTE'
--            WHEN tc_new >= neto THEN 'COBRADO' WHEN tc_new > 0 THEN 'PARCIAL'
--            ELSE 'PENDIENTE' END
--    GROUP BY 1, 2 ORDER BY 3 DESC;
--
-- DRY-RUN 2: el dry-run del runner (ROLLBACK) imprime al final
-- "ordenes_recalculadas = 83".
--
-- VERIFICACION POSTERIOR (despues de --apply; debe devolver 0 filas):
--
--   SELECT o.id, o.estado_cobro, o.total_cobrado, total_cobrado_orden(o.id) AS esperado
--     FROM ordenes_servicio o
--    WHERE EXISTS (SELECT 1 FROM pagos_parciales p JOIN facturas f ON f.id = p.factura_id
--                   WHERE f.orden_id = o.id)
--      AND COALESCE(o.total_cobrado, 0) <> total_cobrado_orden(o.id);
--
--   -- y los triggers existen (3 filas):
--   SELECT tgname FROM pg_trigger
--    WHERE tgname IN ('pagos_parciales_recalcular_cobro',
--                     'facturas_estado_recalcular_cobro',
--                     'facturas_delete_recalcular_cobro');
-- ----------------------------------------------------------------------------

-- 1. Fuente unica del total cobrado de una orden.
CREATE OR REPLACE FUNCTION total_cobrado_orden(p_orden_id TEXT)
RETURNS DECIMAL AS $$
  SELECT GREATEST(
    COALESCE((SELECT SUM(c.monto)
                FROM cobros_orden c
               WHERE c.orden_id = p_orden_id AND c.anulado = FALSE), 0),
    COALESCE((SELECT SUM(p.monto)
                FROM pagos_parciales p
                JOIN facturas f ON f.id = p.factura_id
               WHERE f.orden_id = p_orden_id
                 AND f.estado_pago::text <> 'ANULADA'), 0)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION total_cobrado_orden(TEXT) IS
  'GREATEST(cobros_orden no anulados, pagos_parciales de la factura no anulada). Ver migracion 345.';

-- 2. recalcular_estado_cobro: misma firma y efectos que 068:100; solo cambia
--    de donde sale v_total_cobrado.
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

-- 3. Trigger sobre pagos_parciales (alta, cambio y baja de un pago).
CREATE OR REPLACE FUNCTION trg_pagos_parciales_recalcular_cobro()
RETURNS TRIGGER AS $$
DECLARE
  v_orden_id TEXT;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT orden_id INTO v_orden_id FROM facturas WHERE id = NEW.factura_id;
    IF v_orden_id IS NOT NULL THEN
      PERFORM recalcular_estado_cobro(v_orden_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.factura_id IS DISTINCT FROM NEW.factura_id) THEN
    -- En un DELETE en cascada la factura ya no existe: el trigger de facturas
    -- (AFTER DELETE) cubre ese caso.
    SELECT orden_id INTO v_orden_id FROM facturas WHERE id = OLD.factura_id;
    IF v_orden_id IS NOT NULL THEN
      PERFORM recalcular_estado_cobro(v_orden_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pagos_parciales_recalcular_cobro ON pagos_parciales;
CREATE TRIGGER pagos_parciales_recalcular_cobro
  AFTER INSERT OR UPDATE OF monto, factura_id OR DELETE ON pagos_parciales
  FOR EACH ROW
  EXECUTE FUNCTION trg_pagos_parciales_recalcular_cobro();

-- 4. Trigger sobre facturas: cambio de estado_pago (incluye ANULADA).
CREATE OR REPLACE FUNCTION trg_facturas_recalcular_cobro()
RETURNS TRIGGER AS $$
DECLARE
  v_orden_id TEXT;
BEGIN
  v_orden_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.orden_id ELSE NEW.orden_id END;
  IF v_orden_id IS NOT NULL THEN
    PERFORM recalcular_estado_cobro(v_orden_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facturas_estado_recalcular_cobro ON facturas;
CREATE TRIGGER facturas_estado_recalcular_cobro
  AFTER UPDATE OF estado_pago ON facturas
  FOR EACH ROW
  WHEN (OLD.estado_pago IS DISTINCT FROM NEW.estado_pago)
  EXECUTE FUNCTION trg_facturas_recalcular_cobro();

DROP TRIGGER IF EXISTS facturas_delete_recalcular_cobro ON facturas;
CREATE TRIGGER facturas_delete_recalcular_cobro
  AFTER DELETE ON facturas
  FOR EACH ROW
  EXECUTE FUNCTION trg_facturas_recalcular_cobro();

-- 5. Backfill idempotente: solo ordenes con algun pago de factura cuyo valor
--    derivado difiere del guardado. No inserta dinero. Una segunda corrida
--    encuentra 0 filas.
WITH cambio AS (
  SELECT o.id
    FROM ordenes_servicio o
   WHERE EXISTS (SELECT 1
                   FROM pagos_parciales p
                   JOIN facturas f ON f.id = p.factura_id
                  WHERE f.orden_id = o.id)
     AND (
       COALESCE(o.total_cobrado, 0) <> total_cobrado_orden(o.id)
       OR o.estado_cobro IS DISTINCT FROM CASE
            WHEN COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) <= 0 THEN 'PENDIENTE'
            WHEN total_cobrado_orden(o.id) >= COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) THEN 'COBRADO'
            WHEN total_cobrado_orden(o.id) > 0 THEN 'PARCIAL'
            ELSE 'PENDIENTE'
          END
     )
), recalculadas AS (
  SELECT c.id, recalcular_estado_cobro(c.id) FROM cambio c
)
SELECT COUNT(*) AS ordenes_recalculadas FROM recalculadas;
