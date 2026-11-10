-- =============================================================================
-- Verification of 388 — entrega idempotente y reservas de cotización.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - DESPUÉS de aplicar 388, sin RLS, con
--       node scripts/db-run.mjs supabase/migrations/verify/388_probes.sql
--     o en el SQL editor de Studio.
--   - Todo corre dentro de BEGIN/ROLLBACK: los cargos de prueba, los cambios de
--     stock_reservado y los asientos de movimientos no quedan.
--
-- Resultados en _r388, UN solo SELECT al final. Verde = esperado igual a
-- obtenido, u obtenido empieza con 'OK:'. Un probe sin datos para armarse se
-- saltea solo y lo dice (SALTEADO: ...).
--
-- Qué prueba:
--   P1  el índice único parcial existe, es UNIQUE y su predicado excluye los
--       revertidos;
--   P2  no quedan órdenes con más de un CARGO vigente (0 filas);
--   P3  un segundo CARGO para una orden que ya tiene uno vigente falla con
--       unique_violation (23505), que es lo que la ruta de entrega maneja;
--   P4  con el cargo marcado revertido, la orden admite un cargo nuevo;
--   P5  liberar_items_cotizacion sobre una cotización SIN reserva en el libro
--       no toca stock_reservado (antes se comía la reserva de otra);
--   P6  liberar_items_cotizacion sobre una cotización CON reserva libera lo
--       pendiente y una segunda llamada es un no-op;
--   P7  las tres funciones filtran inventario por organización.
--
-- Nada de esto se corrió contra producción al escribirlo: la primera corrida
-- real es la tuya.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r388 (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- P1 ------------------------------------------------------------------------
INSERT INTO _r388
SELECT 1, 'indice unico parcial de CARGO vigente por orden', 'true',
       COALESCE((
         SELECT (ix.indisunique
                 AND pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%revertido_at IS NULL%'
                 AND pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%ORDEN%')::TEXT
           FROM pg_index ix
           JOIN pg_class c ON c.oid = ix.indexrelid
          WHERE c.relname = 'cuenta_corriente_cargo_orden_vigente_uniq'
       ), 'no existe');

-- P2 ------------------------------------------------------------------------
INSERT INTO _r388
SELECT 2, 'ordenes con mas de un CARGO vigente', '0', COUNT(*)::TEXT
  FROM (
    SELECT 1
      FROM cuenta_corriente
     WHERE tipo = 'CARGO' AND referencia_tipo = 'ORDEN' AND revertido_at IS NULL
     GROUP BY organization_id, referencia_id
    HAVING COUNT(*) > 1
  ) d;

-- P3 / P4 -------------------------------------------------------------------
DO $$
DECLARE
  v_mov cuenta_corriente%ROWTYPE;
BEGIN
  SELECT * INTO v_mov
    FROM cuenta_corriente
   WHERE tipo = 'CARGO' AND referencia_tipo = 'ORDEN' AND revertido_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_mov.id IS NULL THEN
    INSERT INTO _r388 VALUES
      (3, 'segundo CARGO vigente de la misma orden', 'error 23505', 'SALTEADO: no hay CARGO de orden'),
      (4, 'tras revertir, la orden admite un cargo nuevo', 'ok', 'SALTEADO: no hay CARGO de orden');
    RETURN;
  END IF;

  BEGIN
    PERFORM cargar_deuda_cuenta_corriente(
      v_mov.organization_id, v_mov.cliente_id, 1, 'ORDEN', v_mov.referencia_id, NULL, v_mov.sucursal_id);
    INSERT INTO _r388 VALUES (3, 'segundo CARGO vigente de la misma orden', 'error 23505', 'FALLO: se inserto');
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO _r388 VALUES (3, 'segundo CARGO vigente de la misma orden', 'error 23505', 'OK: ' || SQLERRM);
    WHEN OTHERS THEN
      INSERT INTO _r388 VALUES (3, 'segundo CARGO vigente de la misma orden', 'error 23505', 'FALLO: otro error: ' || SQLERRM);
  END;

  UPDATE cuenta_corriente SET revertido_at = NOW() WHERE id = v_mov.id;
  BEGIN
    PERFORM cargar_deuda_cuenta_corriente(
      v_mov.organization_id, v_mov.cliente_id, 1, 'ORDEN', v_mov.referencia_id, NULL, v_mov.sucursal_id);
    INSERT INTO _r388 VALUES (4, 'tras revertir, la orden admite un cargo nuevo', 'ok', 'OK: insertado');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r388 VALUES (4, 'tras revertir, la orden admite un cargo nuevo', 'ok', 'FALLO: ' || SQLERRM);
  END;
END $$;

-- P5 ------------------------------------------------------------------------
-- Una cotización con una línea de inventario de su misma organización y SIN
-- asientos de reserva. Se le infla stock_reservado al producto en 1 (como si
-- otra cotización lo tuviera tomado) y se comprueba que liberar no lo toca.
DO $$
DECLARE
  v_cot     TEXT;
  v_inv     TEXT;
  v_antes   INTEGER;
  v_despues INTEGER;
  v_res     JSONB;
BEGIN
  SELECT c.id, ic.inventario_id INTO v_cot, v_inv
    FROM cotizaciones c
    JOIN items_cotizacion ic ON ic.cotizacion_id = c.id
    JOIN inventario i ON i.id = ic.inventario_id AND i.organization_id = c.organization_id
   WHERE NOT EXISTS (
           SELECT 1 FROM movimientos_inventario mi
            WHERE mi.referencia_id = c.id AND mi.referencia_tipo = 'COTIZACION')
   LIMIT 1;

  IF v_cot IS NULL THEN
    INSERT INTO _r388 VALUES (5, 'liberar sin reserva no toca stock_reservado', 'sin cambios',
      'SALTEADO: no hay cotizacion con inventario y sin asientos');
    RETURN;
  END IF;

  UPDATE inventario SET stock_reservado = COALESCE(stock_reservado, 0) + 1 WHERE id = v_inv;
  SELECT stock_reservado INTO v_antes FROM inventario WHERE id = v_inv;

  v_res := liberar_items_cotizacion(v_cot, NULL, 'probe 388');
  SELECT stock_reservado INTO v_despues FROM inventario WHERE id = v_inv;

  INSERT INTO _r388 VALUES (5, 'liberar sin reserva no toca stock_reservado', 'sin cambios',
    CASE WHEN v_antes = v_despues AND (v_res->>'itemsLiberados')::INT = 0
         THEN 'sin cambios'
         ELSE format('FALLO: %s -> %s, %s', v_antes, v_despues, v_res) END);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r388 VALUES (5, 'liberar sin reserva no toca stock_reservado', 'sin cambios', 'FALLO: ' || SQLERRM);
END $$;

-- P6 ------------------------------------------------------------------------
DO $$
DECLARE
  v_cot  TEXT;
  v_inv  TEXT;
  v_pend INTEGER;
  v_r1   JSONB;
  v_r2   JSONB;
  v_resto INTEGER;
BEGIN
  SELECT c.id INTO v_cot
    FROM cotizaciones c
   WHERE EXISTS (SELECT 1 FROM reserva_cotizacion_pendiente(c.id))
   LIMIT 1;

  IF v_cot IS NULL THEN
    INSERT INTO _r388 VALUES (6, 'liberar con reserva: libera y es idempotente', 'pendiente 0, 2da llamada 0',
      'SALTEADO: no hay cotizacion con reserva viva');
    RETURN;
  END IF;

  -- Asegura que la columna alcance para devolver todo lo pendiente.
  FOR v_inv, v_pend IN SELECT inventario_id, cantidad FROM reserva_cotizacion_pendiente(v_cot) LOOP
    UPDATE inventario SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0), v_pend) WHERE id = v_inv;
  END LOOP;

  v_r1 := liberar_items_cotizacion(v_cot, NULL, 'probe 388');
  v_r2 := liberar_items_cotizacion(v_cot, NULL, 'probe 388');
  SELECT COUNT(*) INTO v_resto FROM reserva_cotizacion_pendiente(v_cot);

  INSERT INTO _r388 VALUES (6, 'liberar con reserva: libera y es idempotente', 'pendiente 0, 2da llamada 0',
    format('pendiente %s, 2da llamada %s', v_resto, v_r2->>'itemsLiberados'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r388 VALUES (6, 'liberar con reserva: libera y es idempotente', 'pendiente 0, 2da llamada 0', 'FALLO: ' || SQLERRM);
END $$;

-- P7 ------------------------------------------------------------------------
INSERT INTO _r388
SELECT 7, 'filtro de organizacion: ' || p.proname, 'true',
       (pg_get_functiondef(p.oid) ILIKE
          CASE p.proname WHEN 'reservar_stock_catalogo'
               THEN '%WHERE id = v_inv_id AND organization_id = p_organization_id%'
               ELSE '%AND organization_id = v_org_id%' END)::TEXT
  FROM pg_proc p
 WHERE p.proname IN ('liberar_items_cotizacion', 'reservar_items_cotizacion', 'reservar_stock_catalogo')
   AND p.pronamespace = 'public'::regnamespace;

SELECT orden, probe, esperado, obtenido FROM _r388 ORDER BY orden, probe;

ROLLBACK;
