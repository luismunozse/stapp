-- ============================================
-- 280: Servicios en órdenes — RPCs atómicos para agregar/eliminar líneas
-- ============================================
-- Bug: app/api/ordenes/[id]/servicios/route.ts hacía SELECT-then-decide-then-UPDATE
-- sobre costo_final sin lock ni transacción. Cada llamada de supabase-js es su
-- propia transacción, así que dos requests concurrentes sobre la misma orden leen
-- el mismo snapshot stale de la suma de líneas:
--
--   A lee: sumaAnterior = 0, costo_final = null
--   B lee: sumaAnterior = 0, costo_final = null     <- mismo snapshot stale
--   A inserta $25.000 -> escribe costo_final = 25.000
--   B inserta  $8.000 -> escribe costo_final =  8.000  <- pisa a A
--
-- Resultado: dos líneas que suman $33.000 y un costo_final de $8.000. El taller
-- termina cobrando de menos por $25.000.
--
-- Fix: mover insert/delete + suma + decisión + escritura a plpgsql, tomando
-- SELECT ... FOR UPDATE sobre la fila de la orden primero para que los callers
-- concurrentes se serialicen. Sigue el patrón atómico de
-- 151_fix_add_repuesto_precio_compra.sql:17-72 (RETURNS JSON, errores como
-- json_build_object('error', ...), FOR UPDATE para lockear, LANGUAGE plpgsql
-- simple, SIN SECURITY DEFINER).
--
-- ============================================
-- ACOPLAMIENTO NORMATIVO — LEER ANTES DE TOCAR ESTE ARCHIVO
-- ============================================
-- El lock de FOR UPDATE solo existe dentro de la transacción de cada RPC, así
-- que la decisión de sincronizar costo_final tiene que evaluarse ahí adentro.
-- Es el precio inevitable de la atomicidad: la regla queda duplicada en dos
-- lenguajes. Para que la duplicación sea auditable en vez de silenciosa:
--
--   1. Regla de sincronización de costo_final. La especificación NORMATIVA es
--      lib/servicios/sincronizar-costo-final.ts (función
--      calcularCostoFinalSincronizado), con 8 tests unitarios en
--      __tests__/lib/sincronizar-costo-final.test.ts. El bloque marcado
--      "SYNC RULE" en cada función de abajo es un espejo manual de esa función
--      y debe ser conductualmente idéntico.
--
--   2. Lista de estados bloqueados. La especificación NORMATIVA es
--      ESTADOS_COSTO_FINAL_BLOQUEADO en lib/orden-state-machine.ts (REPARADO +
--      ESTADOS_ENTREGA). El bloque marcado "STATE GUARD" de abajo hardcodea esa
--      misma lista: 'REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION',
--      'ENTREGADO_SIN_COBRO'.
--
-- CUALQUIER cambio a una de las dos reglas (TS o SQL) DEBE aplicarse también a
-- su contraparte. Ambos archivos TS llevan el comentario recíproco que apunta
-- acá.
-- ============================================

CREATE OR REPLACE FUNCTION agregar_servicio_orden(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_servicio_id TEXT,
  p_nombre TEXT,
  p_cantidad INTEGER,
  p_precio_unitario NUMERIC
)
RETURNS JSON AS $$
DECLARE
  v_costo_final NUMERIC;
  v_total_cobrado NUMERIC;
  v_estado ordenes_servicio.estado%TYPE;
  v_suma_anterior NUMERIC;
  v_suma_nueva NUMERIC;
  v_linea_id TEXT;
  v_nuevo_costo_final NUMERIC;
  v_costo_final_actualizado BOOLEAN := FALSE;
BEGIN
  -- Lock de la fila de la orden: serializa a los callers concurrentes (ver bug
  -- arriba). El predicado organization_id es el límite de tenant y es
  -- obligatorio: los callers usan service_role, que bypassea RLS.
  SELECT costo_final, total_cobrado, estado
  INTO v_costo_final, v_total_cobrado, v_estado
  FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  SELECT COALESCE(SUM(cantidad * precio_unitario), 0)
  INTO v_suma_anterior
  FROM servicios_orden
  WHERE orden_id = p_orden_id;

  INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
  VALUES (p_orden_id, p_servicio_id, p_nombre, p_cantidad, p_precio_unitario)
  RETURNING id INTO v_linea_id;

  v_suma_nueva := ROUND(v_suma_anterior + (p_cantidad * p_precio_unitario), 2);

  -- === SYNC RULE — espejo de calcularCostoFinalSincronizado (ver acoplamiento arriba) ===
  -- Automático solo mientras nadie pagó nada y el costo actual venía siguiendo
  -- a las líneas (o estaba vacío). Si no, decide el humano desde la UI.
  IF COALESCE(v_total_cobrado, 0) <= 0
     AND (v_costo_final IS NULL OR ABS(v_costo_final - v_suma_anterior) < 0.005)
  THEN
    IF v_suma_nueva <= 0 THEN
      v_nuevo_costo_final := NULL;
    ELSE
      v_nuevo_costo_final := ROUND(v_suma_nueva, 2);
    END IF;

    -- === STATE GUARD — espejo de ESTADOS_COSTO_FINAL_BLOQUEADO (ver acoplamiento arriba) ===
    -- La orden ya cruzó el gate de costo_final de REPARADO: no la dejamos en
    -- null/0 en automático aunque la regla de sincronización lo pida. Queda
    -- costoFinalActualizado = false para que la UI muestre el banner de
    -- "Aplicar al total".
    IF (v_nuevo_costo_final IS NULL OR v_nuevo_costo_final = 0)
       AND v_estado IN ('REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
    THEN
      NULL; -- no-op: se deja costo_final como está
    ELSE
      UPDATE ordenes_servicio SET costo_final = v_nuevo_costo_final WHERE id = p_orden_id;
      v_costo_final_actualizado := TRUE;
    END IF;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', v_linea_id,
    'costoFinalActualizado', v_costo_final_actualizado,
    'sumaServicios', v_suma_nueva
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC) IS
  'Inserta una linea en servicios_orden y sincroniza costo_final atomicamente (FOR UPDATE sobre la orden). Espejo obligatorio de calcularCostoFinalSincronizado en lib/servicios/sincronizar-costo-final.ts y de ESTADOS_COSTO_FINAL_BLOQUEADO en lib/orden-state-machine.ts: ver comentario de acoplamiento al inicio de esta migracion (280).';

CREATE OR REPLACE FUNCTION eliminar_servicio_orden(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_servicio_orden_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_costo_final NUMERIC;
  v_total_cobrado NUMERIC;
  v_estado ordenes_servicio.estado%TYPE;
  v_suma_anterior NUMERIC;
  v_suma_nueva NUMERIC;
  v_cantidad INTEGER;
  v_precio_unitario NUMERIC;
  v_nuevo_costo_final NUMERIC;
  v_costo_final_actualizado BOOLEAN := FALSE;
BEGIN
  -- Mismo lock y mismo límite de tenant que agregar_servicio_orden.
  SELECT costo_final, total_cobrado, estado
  INTO v_costo_final, v_total_cobrado, v_estado
  FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  SELECT COALESCE(SUM(cantidad * precio_unitario), 0)
  INTO v_suma_anterior
  FROM servicios_orden
  WHERE orden_id = p_orden_id;

  SELECT cantidad, precio_unitario
  INTO v_cantidad, v_precio_unitario
  FROM servicios_orden
  WHERE id = p_servicio_orden_id AND orden_id = p_orden_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Servicio no encontrado en la orden');
  END IF;

  DELETE FROM servicios_orden WHERE id = p_servicio_orden_id AND orden_id = p_orden_id;

  v_suma_nueva := ROUND(v_suma_anterior - (v_cantidad * v_precio_unitario), 2);

  -- === SYNC RULE — espejo de calcularCostoFinalSincronizado (ver acoplamiento arriba) ===
  IF COALESCE(v_total_cobrado, 0) <= 0
     AND (v_costo_final IS NULL OR ABS(v_costo_final - v_suma_anterior) < 0.005)
  THEN
    IF v_suma_nueva <= 0 THEN
      v_nuevo_costo_final := NULL;
    ELSE
      v_nuevo_costo_final := ROUND(v_suma_nueva, 2);
    END IF;

    -- === STATE GUARD — espejo de ESTADOS_COSTO_FINAL_BLOQUEADO (ver acoplamiento arriba) ===
    IF (v_nuevo_costo_final IS NULL OR v_nuevo_costo_final = 0)
       AND v_estado IN ('REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
    THEN
      NULL; -- no-op: se deja costo_final como está
    ELSE
      UPDATE ordenes_servicio SET costo_final = v_nuevo_costo_final WHERE id = p_orden_id;
      v_costo_final_actualizado := TRUE;
    END IF;
  END IF;

  RETURN json_build_object(
    'success', true,
    'costoFinalActualizado', v_costo_final_actualizado,
    'sumaServicios', v_suma_nueva
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_servicio_orden(TEXT, TEXT, TEXT) IS
  'Elimina una linea de servicios_orden y sincroniza costo_final atomicamente (FOR UPDATE sobre la orden). Espejo obligatorio de calcularCostoFinalSincronizado en lib/servicios/sincronizar-costo-final.ts y de ESTADOS_COSTO_FINAL_BLOQUEADO en lib/orden-state-machine.ts: ver comentario de acoplamiento al inicio de esta migracion (280).';
