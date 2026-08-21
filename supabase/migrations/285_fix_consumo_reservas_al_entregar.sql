-- Migration 285: el consumo de reservas al entregar fallaba en silencio y el
-- stock nunca se descontaba.
--
-- SINTOMA
--
-- Los repuestos se reservaban bien al cargarlos en la orden, pero al entregar
-- el stock fisico no bajaba: quedaba reservado para siempre. Sin ningun error
-- visible ni en la UI ni en los logs.
--
-- CAUSA
--
-- Son tres defectos encadenados.
--
-- 1. reservar_stock_deposito (mig 206) en modo drain reparte la reserva entre
--    los depositos que tengan capacidad, pero termina con `RETURN v_target`:
--    devuelve el deposito que se PIDIO, no aquel de donde realmente reservo.
--    add_repuesto_inventario persiste ese valor en repuestos_orden.deposito_id
--    creyendo que es el deposito efectivo.
--
-- 2. consumir_reservas_orden descontaba contra ese deposito con strict = TRUE:
--
--      descontar_stock_deposito(..., v_dep_objetivo, cantidad,
--                               v_dep_objetivo IS NOT NULL)
--
--    y descontar_stock_deposito en modo strict RAISE una excepcion P0010 si ese
--    deposito puntual no tiene stock suficiente. Como el deposito registrado
--    puede no ser donde esta el stock, la excepcion aborta toda la funcion y no
--    se descuenta NINGUN repuesto de la orden.
--
--    La asimetria es el nucleo del bug: la reserva es tolerante (reparte entre
--    depositos y avisa con WARNING si no alcanza), el consumo era estricto.
--
-- 3. La ruta /entregar no leia el `error` que devuelve supabase.rpc(), asi que
--    el fallo era invisible (se corrige en el mismo PR, del lado de la app).
--
-- FIX
--
-- El consumo pasa a modo drain (strict = false), igual que la reserva:
-- descuenta de los depositos que efectivamente tengan stock, empezando por el
-- registrado, y si el detalle por deposito quedo desincronizado absorbe el
-- resto en el target avisando por WARNING en vez de abortar. La validacion que
-- importa (stock global suficiente) ya la hizo add_repuesto_inventario al
-- reservar.

-- ============================================================
-- 1. consumir_reservas_orden — drain en vez de strict
--    Base: mig 222 (linea 490). Unico cambio funcional: el 5o argumento de
--    descontar_stock_deposito pasa de `v_dep_objetivo IS NOT NULL` a `false`.
-- ============================================================
CREATE OR REPLACE FUNCTION public.consumir_reservas_orden(
  p_orden_id text, p_user_id text, p_deposito_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_rep               RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_count             INTEGER := 0;
  v_cantidad_reservada INTEGER;
  v_deposito_efectivo TEXT;
  v_suc_id            TEXT;
  v_dep_objetivo      TEXT;
BEGIN
  SELECT organization_id, sucursal_id INTO v_org_id, v_suc_id
  FROM ordenes_servicio WHERE id = p_orden_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  FOR v_rep IN
    SELECT ro.inventario_id, ro.cantidad, ro.deposito_id
    FROM repuestos_orden ro
    WHERE ro.orden_id = p_orden_id
      AND ro.inventario_id IS NOT NULL
  LOOP
    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_rep.inventario_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_cantidad_reservada := LEAST(v_rep.cantidad, v_stock_reservado);

    -- Deposito: el que se uso al reservar (persistido); explicito si se pasa;
    -- fallback al principal de la sucursal para reservas legacy sin deposito_id.
    v_dep_objetivo := COALESCE(p_deposito_id, v_rep.deposito_id, get_deposito_de_sucursal(v_suc_id));

    UPDATE inventario
    SET stock = stock - v_rep.cantidad,
        stock_reservado = stock_reservado - v_cantidad_reservada
    WHERE id = v_rep.inventario_id;

    -- strict = false: el deposito registrado puede no ser donde quedo el stock
    -- (ver cabecera). En modo drain descuenta de donde haya, target primero, y
    -- absorbe el faltante en el target con WARNING en vez de abortar la entrega.
    v_deposito_efectivo := descontar_stock_deposito(
      v_rep.inventario_id, v_org_id, v_dep_objetivo, v_rep.cantidad, false);
    PERFORM liberar_reserva_deposito(
      v_rep.inventario_id, v_org_id, v_deposito_efectivo, v_cantidad_reservada);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_rep.inventario_id, 'SALIDA', v_rep.cantidad,
      v_stock, v_stock - v_rep.cantidad,
      p_orden_id, 'orden_servicio', p_user_id, v_org_id,
      'Consumo de repuesto al entregar orden',
      v_deposito_efectivo
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsConsumidos', v_count);
END;
$function$;

COMMENT ON FUNCTION public.consumir_reservas_orden(text, text, text) IS
  'Consume las reservas de repuestos al entregar una orden. Descuenta en modo drain: tolera que el detalle por deposito este desincronizado en vez de abortar la entrega.';

-- ============================================================
-- 2. reparar_consumos_fallidos — reparacion de las ordenes ya afectadas
--
--    NO se ejecuta sola. Hay que invocarla a mano:
--
--      -- ver que haria, sin tocar nada:
--      SELECT * FROM reparar_consumos_fallidos(NULL, true);
--      -- aplicar sobre una organizacion:
--      SELECT * FROM reparar_consumos_fallidos('<org_id>', false);
--
--    Detecta el fallo de forma exacta, no heuristica: si el consumo hubiera
--    corrido, existiria un movimiento SALIDA para ese (orden, inventario). Su
--    ausencia en una orden ya entregada significa que la RPC aborto.
--
--    Es idempotente: al reparar inserta el SALIDA, asi que una segunda corrida
--    ya no encuentra esa fila.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reparar_consumos_fallidos(
  p_org_id  TEXT DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  orden_id        TEXT,
  numero_orden    INTEGER,
  inventario_id   TEXT,
  codigo          TEXT,
  cantidad        INTEGER,
  stock_antes     INTEGER,
  stock_despues   INTEGER,
  reserva_liberada INTEGER,
  aplicado        BOOLEAN
) AS $$
DECLARE
  v_rep               RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_liberar           INTEGER;
  v_nuevo_stock       INTEGER;
  v_deposito_efectivo TEXT;
BEGIN
  FOR v_rep IN
    SELECT ro.id AS repuesto_id, ro.inventario_id, ro.cantidad, ro.deposito_id,
           os.id AS orden_id, os.numero_orden, os.organization_id, os.sucursal_id,
           i.codigo
    FROM repuestos_orden ro
    JOIN ordenes_servicio os ON os.id = ro.orden_id
    JOIN inventario i ON i.id = ro.inventario_id
    WHERE ro.inventario_id IS NOT NULL
      AND os.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
      AND (p_org_id IS NULL OR os.organization_id = p_org_id)
      AND NOT EXISTS (
        SELECT 1 FROM movimientos_inventario mi
        WHERE mi.referencia_id = os.id
          AND mi.referencia_tipo = 'orden_servicio'
          AND mi.tipo = 'SALIDA'
          AND mi.inventario_id = ro.inventario_id
      )
    ORDER BY os.numero_orden
  LOOP
    SELECT i.stock, i.stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario i WHERE i.id = v_rep.inventario_id
    FOR UPDATE;

    -- El stock no puede quedar negativo: el CHECK de movimientos_inventario
    -- exige stock_posterior >= 0 y un stock negativo no representa nada real.
    v_nuevo_stock := GREATEST(v_stock - v_rep.cantidad, 0);
    v_liberar := LEAST(v_rep.cantidad, v_stock_reservado);

    IF NOT p_dry_run THEN
      UPDATE inventario
      SET stock = v_nuevo_stock,
          stock_reservado = stock_reservado - v_liberar
      WHERE id = v_rep.inventario_id;

      v_deposito_efectivo := descontar_stock_deposito(
        v_rep.inventario_id, v_rep.organization_id,
        COALESCE(v_rep.deposito_id, get_deposito_de_sucursal(v_rep.sucursal_id)),
        v_stock - v_nuevo_stock, false);

      IF v_liberar > 0 THEN
        PERFORM liberar_reserva_deposito(
          v_rep.inventario_id, v_rep.organization_id, v_deposito_efectivo, v_liberar);
      END IF;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id,
        observaciones, deposito_id
      ) VALUES (
        v_rep.inventario_id, 'SALIDA', v_rep.cantidad, v_stock, v_nuevo_stock,
        v_rep.orden_id, 'orden_servicio', v_rep.organization_id,
        'Consumo de repuesto al entregar orden (reparacion migracion 285)',
        v_deposito_efectivo
      );
    END IF;

    orden_id         := v_rep.orden_id;
    numero_orden     := v_rep.numero_orden;
    inventario_id    := v_rep.inventario_id;
    codigo           := v_rep.codigo;
    cantidad         := v_rep.cantidad;
    stock_antes      := v_stock;
    stock_despues    := v_nuevo_stock;
    reserva_liberada := v_liberar;
    aplicado         := NOT p_dry_run;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.reparar_consumos_fallidos(TEXT, BOOLEAN) IS
  'Repara ordenes entregadas cuyo consumo de reservas aborto: descuenta el stock y libera la reserva. Dry-run por defecto. Idempotente (se guia por la ausencia del movimiento SALIDA).';
