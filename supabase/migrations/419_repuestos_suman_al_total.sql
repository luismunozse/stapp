-- ============================================================================
-- 419: los repuestos suman al monto de la orden igual que los servicios
-- ============================================================================
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el codigo. El codigo nuevo
-- compara el aviso "Aplicar al total" contra servicios + repuestos; sin la
-- migracion el boton seguiria escribiendo solo la suma de servicios.
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/419_...sql
-- (dry-run por defecto, --apply para confirmar). Sin BEGIN/COMMIT a proposito.
--
-- PROBLEMA
-- El monto vivo de la orden (presupuesto antes de APROBADO, costo_final desde
-- APROBADO; ver 303) solo seguia a las lineas de servicio. Cargar, quitar o
-- cambiar la cantidad de un repuesto no movia nada: el cobro (que sale de
-- costo_final) quedaba sin los repuestos salvo que alguien tipeara el total a
-- mano. En prod (2026-11-20, ultimos 90 dias): 62 ordenes con repuestos que no
-- entraron al total, 48 ya entregadas.
--
-- REGLA (la misma de la 303/304, cambia solo QUE se suma)
--   lineas = SUM(servicios_orden.cantidad * precio_unitario)
--          + SUM(repuestos_orden.cantidad * COALESCE(precio_venta_unitario, precio_unitario, 0))
--   El repuesto suma a precio de VENTA. Sin venta (filas previas a la 286) cae
--   al costo, igual que entregar/route.ts y precioVentaRepuesto (lib/db-utils).
--   Sincroniza solo si no hay cobros y el monto vivo venia siguiendo a las
--   lineas (o estaba vacio). Si no, decide el humano con "Aplicar al total".
--
-- EFECTO EN ORDENES EXISTENTES
--   Una orden con repuestos cuyo monto hoy es igual a la suma de SERVICIOS
--   (el repuesto quedo afuera) ya no "sigue a las lineas": deja de sincronizar
--   sola y la UI le muestra "Aplicar al total". No se reescribe ningun monto.
--
-- PIEZAS
--   suma_lineas_orden(orden)                         -> el numero de arriba
--   sincronizar_monto_lineas_orden(orden, anterior)  -> la regla (unica copia)
--   agregar/eliminar_servicio_orden                  -> misma firma, delegan
--   aplicar_monto_servicios_orden                    -> usa suma_lineas_orden
--   trigger repuestos_orden_sincroniza_monto         -> cubre los 4 caminos
--     que escriben repuestos (add_repuesto_inventario, remove_repuesto_inventario,
--     update_repuesto_cantidad y el alta manual de /api/ordenes/[id]/repuestos).
--
-- ACOPLAMIENTO: la regla sigue siendo espejo de calcularCostoFinalSincronizado
-- y calcularMontoSincronizado (lib/servicios/sincronizar-costo-final.ts) y de
-- ESTADOS_*_BLOQUEADO (lib/orden-state-machine.ts). La suma es espejo de
-- sumaLineasOrden (lib/servicios/suma-lineas-orden.ts).
--
-- LOCKS: el trigger bloquea la orden despues de que el RPC de repuestos
-- bloqueo el inventario (inventario -> orden). Ningun camino conocido bloquea
-- en el orden inverso dentro de una misma transaccion.
--
-- VERIFICACION POSTERIOR:
--   SELECT tgname FROM pg_trigger WHERE tgname = 'repuestos_orden_sincroniza_monto'; -- 1 fila
--   SELECT suma_lineas_orden(id) FROM ordenes_servicio LIMIT 1;                      -- no falla
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION suma_lineas_orden(p_orden_id TEXT)
RETURNS NUMERIC AS $$
  SELECT ROUND(
    COALESCE((SELECT SUM(cantidad * precio_unitario)
                FROM servicios_orden WHERE orden_id = p_orden_id), 0)
    + COALESCE((SELECT SUM(cantidad * COALESCE(precio_venta_unitario, precio_unitario, 0))
                  FROM repuestos_orden WHERE orden_id = p_orden_id), 0)
  , 2);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION suma_lineas_orden(TEXT) IS
  'Servicios + repuestos (a precio de venta, con el costo como respaldo) de una orden. Espejo de sumaLineasOrden en lib/servicios/suma-lineas-orden.ts. Ver migracion 419.';

-- La regla de la 303/304, en un solo lugar. p_suma_anterior es la suma de
-- lineas ANTES del cambio: contra ella se decide si el monto vivo "venia
-- siguiendo a las lineas". La suma nueva se lee aca, despues del cambio.
CREATE OR REPLACE FUNCTION sincronizar_monto_lineas_orden(
  p_orden_id TEXT,
  p_suma_anterior NUMERIC
)
RETURNS JSON AS $$
DECLARE
  v_presupuesto NUMERIC;
  v_costo_final NUMERIC;
  v_total_cobrado NUMERIC;
  v_estado ordenes_servicio.estado%TYPE;
  v_suma_nueva NUMERIC;
  v_campo TEXT;
  v_valor_actual NUMERIC;
  v_nuevo_monto NUMERIC;
  v_actualizado BOOLEAN := FALSE;
  v_limpiar_huerfano BOOLEAN := FALSE;
BEGIN
  SELECT presupuesto, costo_final, total_cobrado, estado
  INTO v_presupuesto, v_costo_final, v_total_cobrado, v_estado
  FROM ordenes_servicio
  WHERE id = p_orden_id
  FOR UPDATE;

  -- Orden borrada (cascade sobre repuestos_orden): nada que sincronizar.
  IF NOT FOUND THEN
    RETURN json_build_object('montoActualizado', false, 'sumaLineas', NULL);
  END IF;

  v_suma_nueva := suma_lineas_orden(p_orden_id);

  -- === CAMPO VIVO — espejo de campoSincronizadoPara ===
  v_campo := CASE
    WHEN v_estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO') THEN 'presupuesto'
    WHEN v_estado IN ('APROBADO', 'EN_REPARACION', 'ESPERANDO_REPUESTO', 'REPARADO') THEN 'costo_final'
    ELSE NULL
  END;

  IF v_campo IS NOT NULL THEN
    v_valor_actual := CASE WHEN v_campo = 'presupuesto' THEN v_presupuesto ELSE v_costo_final END;

    -- === SYNC RULE — espejo de calcularCostoFinalSincronizado ===
    IF COALESCE(v_total_cobrado, 0) <= 0
       AND (v_valor_actual IS NULL OR ABS(v_valor_actual - p_suma_anterior) < 0.005)
    THEN
      IF v_suma_nueva <= 0 THEN
        v_nuevo_monto := NULL;
      ELSE
        v_nuevo_monto := v_suma_nueva;
      END IF;

      -- === STATE GUARD — espejo de ESTADOS_*_BLOQUEADO ===
      IF (v_nuevo_monto IS NULL OR v_nuevo_monto = 0)
         AND (
           (v_campo = 'costo_final' AND v_estado IN ('REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO'))
           OR (v_campo = 'presupuesto' AND v_estado = 'PRESUPUESTADO')
         )
      THEN
        NULL; -- no-op: se deja el monto como esta
      ELSIF v_campo = 'presupuesto' THEN
        -- HUERFANO (304): un costo_final que coincide con la suma anterior lo
        -- escribio la regla previa a la 303. Mismo UPDATE para no disparar dos
        -- veces el trigger de la 277.
        v_limpiar_huerfano := v_costo_final IS NOT NULL
          AND ABS(v_costo_final - p_suma_anterior) < 0.005;

        IF v_limpiar_huerfano THEN
          UPDATE ordenes_servicio
          SET presupuesto = v_nuevo_monto, costo_final = NULL
          WHERE id = p_orden_id;
        ELSE
          UPDATE ordenes_servicio SET presupuesto = v_nuevo_monto WHERE id = p_orden_id;
        END IF;
        v_actualizado := TRUE;
      ELSE
        UPDATE ordenes_servicio SET costo_final = v_nuevo_monto WHERE id = p_orden_id;
        v_actualizado := TRUE;
      END IF;
    END IF;
  END IF;

  RETURN json_build_object(
    'campoSincronizado', CASE WHEN v_actualizado THEN v_campo ELSE NULL END,
    'montoActualizado', v_actualizado,
    'costoFinalHuerfanoLimpiado', v_limpiar_huerfano,
    'costoFinalActualizado', v_actualizado AND v_campo = 'costo_final',
    'sumaLineas', v_suma_nueva
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sincronizar_monto_lineas_orden(TEXT, NUMERIC) IS
  'Regla unica de sincronizacion del monto vivo de la orden con sus lineas (servicios + repuestos). La llaman los RPCs de servicios y el trigger de repuestos_orden. Espejo de lib/servicios/sincronizar-costo-final.ts. Ver migraciones 303, 304 y 419.';

-- Firma IDENTICA a la 301/303/304: con otra firma CREATE OR REPLACE crearia
-- una sobrecarga y quedarian dos versiones vivas.
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
  v_suma_anterior NUMERIC;
  v_linea servicios_orden%ROWTYPE;
  v_sync JSON;
BEGIN
  -- Lock de la orden con el limite de tenant: los callers usan service_role.
  PERFORM 1 FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  v_suma_anterior := suma_lineas_orden(p_orden_id);

  -- RETURNING captura el valor PERSISTIDO: precio_unitario es DECIMAL(10,2).
  INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
  VALUES (p_orden_id, p_servicio_id, p_nombre, p_cantidad, p_precio_unitario)
  RETURNING * INTO v_linea;

  v_sync := sincronizar_monto_lineas_orden(p_orden_id, v_suma_anterior);

  RETURN json_build_object(
    'success', true,
    'id', v_linea.id,
    'servicio_id', v_linea.servicio_id,
    'nombre', v_linea.nombre,
    'cantidad', v_linea.cantidad,
    'precio_unitario', v_linea.precio_unitario,
    'campoSincronizado', v_sync->'campoSincronizado',
    'montoActualizado', (v_sync->>'montoActualizado')::boolean,
    'costoFinalHuerfanoLimpiado', (v_sync->>'costoFinalHuerfanoLimpiado')::boolean,
    'costoFinalActualizado', (v_sync->>'costoFinalActualizado')::boolean,
    'sumaServicios', (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) FROM servicios_orden WHERE orden_id = p_orden_id),
    'sumaLineas', (v_sync->>'sumaLineas')::numeric
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION eliminar_servicio_orden(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_servicio_orden_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_suma_anterior NUMERIC;
  v_borradas INTEGER;
  v_sync JSON;
BEGIN
  PERFORM 1 FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  v_suma_anterior := suma_lineas_orden(p_orden_id);

  DELETE FROM servicios_orden WHERE id = p_servicio_orden_id AND orden_id = p_orden_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  IF v_borradas = 0 THEN
    RETURN json_build_object('error', 'Linea no encontrada');
  END IF;

  v_sync := sincronizar_monto_lineas_orden(p_orden_id, v_suma_anterior);

  RETURN json_build_object(
    'success', true,
    'campoSincronizado', v_sync->'campoSincronizado',
    'montoActualizado', (v_sync->>'montoActualizado')::boolean,
    'costoFinalHuerfanoLimpiado', (v_sync->>'costoFinalHuerfanoLimpiado')::boolean,
    'costoFinalActualizado', (v_sync->>'costoFinalActualizado')::boolean,
    'sumaServicios', (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) FROM servicios_orden WHERE orden_id = p_orden_id),
    'sumaLineas', (v_sync->>'sumaLineas')::numeric
  );
END;
$$ LANGUAGE plpgsql;

-- "Aplicar al total": igual que en la 304, pero con servicios + repuestos.
CREATE OR REPLACE FUNCTION aplicar_monto_servicios_orden(
  p_orden_id TEXT,
  p_organization_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_total_cobrado NUMERIC;
  v_estado ordenes_servicio.estado%TYPE;
  v_suma NUMERIC;
  v_campo TEXT;
BEGIN
  SELECT total_cobrado, estado
  INTO v_total_cobrado, v_estado
  FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  v_campo := CASE
    WHEN v_estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO') THEN 'presupuesto'
    WHEN v_estado IN ('APROBADO', 'EN_REPARACION', 'ESPERANDO_REPUESTO', 'REPARADO') THEN 'costo_final'
    ELSE NULL
  END;

  IF v_campo IS NULL THEN
    RETURN json_build_object('error', 'La orden esta en un estado terminal: su monto ya no se sincroniza');
  END IF;

  v_suma := suma_lineas_orden(p_orden_id);

  -- === STATE GUARD — espejo de puedeAplicarMonto (ver 304) ===
  IF v_suma <= 0 AND (
       (v_campo = 'costo_final' AND v_estado IN ('REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO'))
       OR (v_campo = 'presupuesto' AND v_estado = 'PRESUPUESTADO')
     )
  THEN
    RETURN json_build_object(
      'error',
      CASE WHEN v_campo = 'presupuesto'
           THEN 'La orden ya fue presupuestada: no puede quedar sin presupuesto'
           ELSE 'La orden ya fue reparada: no puede quedar sin costo final'
      END
    );
  END IF;

  IF v_campo = 'costo_final' AND v_suma < COALESCE(v_total_cobrado, 0) THEN
    RETURN json_build_object(
      'error', 'El total de servicios y repuestos es menor a lo ya cobrado en esta orden'
    );
  END IF;

  IF v_campo = 'presupuesto' THEN
    UPDATE ordenes_servicio SET presupuesto = NULLIF(v_suma, 0) WHERE id = p_orden_id;
  ELSE
    UPDATE ordenes_servicio SET costo_final = NULLIF(v_suma, 0) WHERE id = p_orden_id;
  END IF;

  RETURN json_build_object('success', true, 'campoSincronizado', v_campo, 'monto', NULLIF(v_suma, 0));
END;
$$ LANGUAGE plpgsql;

-- Trigger de repuestos: la suma anterior se reconstruye restando el aporte de
-- esta fila a la suma actual. Por fila, asi un INSERT de varias filas aplica
-- la regla paso a paso igual que varias altas sueltas.
CREATE OR REPLACE FUNCTION trg_repuestos_orden_sincroniza_monto()
RETURNS TRIGGER AS $$
DECLARE
  v_aporte_old NUMERIC := 0;
  v_aporte_new NUMERIC := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_aporte_old := OLD.cantidad * COALESCE(OLD.precio_venta_unitario, OLD.precio_unitario, 0);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_aporte_new := NEW.cantidad * COALESCE(NEW.precio_venta_unitario, NEW.precio_unitario, 0);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.orden_id IS DISTINCT FROM OLD.orden_id THEN
    -- Mover una linea entre ordenes: baja en una, alta en la otra.
    PERFORM 1 FROM ordenes_servicio WHERE id = OLD.orden_id FOR UPDATE;
    PERFORM sincronizar_monto_lineas_orden(OLD.orden_id, suma_lineas_orden(OLD.orden_id) + ROUND(v_aporte_old, 2));
    PERFORM 1 FROM ordenes_servicio WHERE id = NEW.orden_id FOR UPDATE;
    PERFORM sincronizar_monto_lineas_orden(NEW.orden_id, suma_lineas_orden(NEW.orden_id) - ROUND(v_aporte_new, 2));
    RETURN NULL;
  END IF;

  IF ABS(v_aporte_new - v_aporte_old) < 0.005 THEN
    RETURN NULL; -- no cambio el importe (p. ej. se movio de deposito)
  END IF;

  -- Lock antes de leer la suma: con la orden bloqueada nadie mas cambia sus
  -- lineas entre esta lectura y la decision.
  PERFORM 1 FROM ordenes_servicio WHERE id = COALESCE(NEW.orden_id, OLD.orden_id) FOR UPDATE;
  PERFORM sincronizar_monto_lineas_orden(
    COALESCE(NEW.orden_id, OLD.orden_id),
    suma_lineas_orden(COALESCE(NEW.orden_id, OLD.orden_id)) - ROUND(v_aporte_new - v_aporte_old, 2)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS repuestos_orden_sincroniza_monto ON repuestos_orden;
CREATE TRIGGER repuestos_orden_sincroniza_monto
  AFTER INSERT OR DELETE OR UPDATE OF cantidad, precio_unitario, precio_venta_unitario, orden_id
  ON repuestos_orden
  FOR EACH ROW
  EXECUTE FUNCTION trg_repuestos_orden_sincroniza_monto();

COMMENT ON FUNCTION agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC) IS
  'Inserta una linea en servicios_orden y sincroniza el monto VIVO de la orden con servicios + repuestos (sincronizar_monto_lineas_orden), con FOR UPDATE sobre la orden. Ver migraciones 303, 304 y 419.';

COMMENT ON FUNCTION eliminar_servicio_orden(TEXT, TEXT, TEXT) IS
  'Elimina una linea de servicios_orden y sincroniza el monto VIVO de la orden con servicios + repuestos. Ver migracion 419.';

COMMENT ON FUNCTION aplicar_monto_servicios_orden(TEXT, TEXT) IS
  'Boton "Aplicar al total": escribe servicios + repuestos (suma_lineas_orden) en el monto vivo de la orden. Rechaza dejar costo_final por debajo de total_cobrado. Ver migraciones 304 y 419.';
