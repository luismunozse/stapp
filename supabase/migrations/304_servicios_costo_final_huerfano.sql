-- 304: limpiar el costo_final huerfano y cerrar el hueco de aplicar_monto
--
-- DOS CORRECCIONES SOBRE LA 303
--
-- (1) COSTO_FINAL HUERFANO
--
-- Hasta la 303 la sincronizacion escribia SIEMPRE costo_final, sin mirar el
-- estado. Las ordenes anteriores a APROBADO que ya existian cuando se aplico la
-- 303 arrastran un costo_final de esa epoca que la regla nueva ya no gobierna:
-- en esos estados el campo vivo paso a ser presupuesto.
--
-- Ese numero no genera deuda hoy (get_deuda_cliente_sucursal y el widget de caja
-- filtran estado IN ('REPARADO','ENTREGADO')), pero el dano es diferido:
--
--   a. Al llegar a APROBADO la sincronizacion compara costo_final contra la suma
--      de lineas, no coinciden, lo lee como "editado a mano" y deja de
--      sincronizar esa orden PARA SIEMPRE.
--   b. Si llega a REPARADO con ese numero, eso es lo que se le cobra al cliente:
--      el precio de una linea que quiza ya se borro.
--
-- La rama del presupuesto ahora limpia ese costo_final, pero SOLO cuando
-- coincide con la suma de lineas anterior. Esa coincidencia es la huella de la
-- regla vieja; un numero tipeado por una persona no coincide y queda intacto.
--
-- ALCANCE: esto cura las ordenes que vuelvan a tener movimiento de lineas. Las
-- que ya quedaron sin lineas no tienen suma contra la cual comparar y no se
-- curan solas: para esas, ver docs/304-costo-final-huerfano-dryrun.sql.
--
-- (2) STATE GUARD FALTANTE EN aplicar_monto_servicios_orden
--
-- La 303 la creo sin el guard de ESTADOS_*_BLOQUEADO. Con cero lineas,
-- NULLIF(0, 0) devuelve NULL, asi que "Aplicar al total" dejaba sin costo_final
-- a una orden ya REPARADA. Es exactamente el bug 2b que el PR #254 habia cerrado
-- para la ruta automatica, reabierto por la manual.
--
-- ACOPLAMIENTO: espejo de calcularMontoSincronizado y puedeAplicarMonto en
-- lib/servicios/sincronizar-costo-final.ts. Cualquier cambio en una punta DEBE
-- aplicarse en la otra.

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
  v_presupuesto NUMERIC;
  v_costo_final NUMERIC;
  v_total_cobrado NUMERIC;
  v_estado ordenes_servicio.estado%TYPE;
  v_suma_anterior NUMERIC;
  v_suma_nueva NUMERIC;
  v_linea_id TEXT;
  v_linea_servicio_id TEXT;
  v_linea_nombre TEXT;
  v_linea_cantidad INTEGER;
  v_linea_precio_unitario NUMERIC;
  v_campo TEXT;
  v_valor_actual NUMERIC;
  v_nuevo_monto NUMERIC;
  v_actualizado BOOLEAN := FALSE;
  v_limpiar_huerfano BOOLEAN := FALSE;
BEGIN
  -- Lock de la fila de la orden: serializa a los callers concurrentes. El
  -- predicado organization_id es el limite de tenant y es obligatorio: los
  -- callers usan service_role, que bypassea RLS.
  SELECT presupuesto, costo_final, total_cobrado, estado
  INTO v_presupuesto, v_costo_final, v_total_cobrado, v_estado
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

  -- RETURNING captura el valor PERSISTIDO, no el parametro de entrada:
  -- precio_unitario es DECIMAL(10,2) y Postgres redondea al guardar.
  INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
  VALUES (p_orden_id, p_servicio_id, p_nombre, p_cantidad, p_precio_unitario)
  RETURNING id, servicio_id, nombre, cantidad, precio_unitario
  INTO v_linea_id, v_linea_servicio_id, v_linea_nombre, v_linea_cantidad, v_linea_precio_unitario;

  v_suma_nueva := ROUND(v_suma_anterior + (p_cantidad * p_precio_unitario), 2);

  -- === CAMPO VIVO — espejo de campoSincronizadoPara ===
  v_campo := CASE
    WHEN v_estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO') THEN 'presupuesto'
    WHEN v_estado IN ('APROBADO', 'EN_REPARACION', 'ESPERANDO_REPUESTO', 'REPARADO') THEN 'costo_final'
    ELSE NULL
  END;

  IF v_campo IS NOT NULL THEN
    v_valor_actual := CASE WHEN v_campo = 'presupuesto' THEN v_presupuesto ELSE v_costo_final END;

    -- === SYNC RULE — espejo de calcularCostoFinalSincronizado ===
    -- Automatico solo mientras nadie pago nada y el monto vivo venia siguiendo
    -- a las lineas (o estaba vacio). Si no, decide el humano desde la UI.
    IF COALESCE(v_total_cobrado, 0) <= 0
       AND (v_valor_actual IS NULL OR ABS(v_valor_actual - v_suma_anterior) < 0.005)
    THEN
      IF v_suma_nueva <= 0 THEN
        v_nuevo_monto := NULL;
      ELSE
        v_nuevo_monto := ROUND(v_suma_nueva, 2);
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
        -- HUERFANO: un costo_final que coincide con la suma de lineas ANTERIOR
        -- lo escribio la regla previa a la 303, que sincronizaba siempre
        -- costo_final sin mirar el estado. La regla nueva ya no lo gobierna, asi
        -- que si no se limpia queda esperando a que alguien lleve la orden a
        -- REPARADO y termina siendo lo que se le cobra al cliente. Un numero
        -- tipeado por una persona NO coincide con la suma y no se toca.
        -- Se escribe en el MISMO UPDATE para no disparar dos veces el trigger de
        -- la 277.
        v_limpiar_huerfano := v_costo_final IS NOT NULL
          AND ABS(v_costo_final - v_suma_anterior) < 0.005;

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
    'success', true,
    'id', v_linea_id,
    'servicio_id', v_linea_servicio_id,
    'nombre', v_linea_nombre,
    'cantidad', v_linea_cantidad,
    'precio_unitario', v_linea_precio_unitario,
    'campoSincronizado', CASE WHEN v_actualizado THEN v_campo ELSE NULL END,
    'montoActualizado', v_actualizado,
    'costoFinalHuerfanoLimpiado', v_limpiar_huerfano,
    'costoFinalActualizado', v_actualizado AND v_campo = 'costo_final',
    'sumaServicios', v_suma_nueva
  );
END;
$$ LANGUAGE plpgsql;

-- Firma IDENTICA a la de la 301 (mismos nombres, mismo orden): con una firma
-- distinta CREATE OR REPLACE no reemplaza, crea una sobrecarga y quedan las dos
-- versiones vivas.
CREATE OR REPLACE FUNCTION eliminar_servicio_orden(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_servicio_orden_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_presupuesto NUMERIC;
  v_costo_final NUMERIC;
  v_total_cobrado NUMERIC;
  v_estado ordenes_servicio.estado%TYPE;
  v_suma_anterior NUMERIC;
  v_suma_nueva NUMERIC;
  v_borradas INTEGER;
  v_campo TEXT;
  v_valor_actual NUMERIC;
  v_nuevo_monto NUMERIC;
  v_actualizado BOOLEAN := FALSE;
  v_limpiar_huerfano BOOLEAN := FALSE;
BEGIN
  SELECT presupuesto, costo_final, total_cobrado, estado
  INTO v_presupuesto, v_costo_final, v_total_cobrado, v_estado
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

  DELETE FROM servicios_orden WHERE id = p_servicio_orden_id AND orden_id = p_orden_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  IF v_borradas = 0 THEN
    RETURN json_build_object('error', 'Linea no encontrada');
  END IF;

  SELECT COALESCE(SUM(cantidad * precio_unitario), 0)
  INTO v_suma_nueva
  FROM servicios_orden
  WHERE orden_id = p_orden_id;

  v_campo := CASE
    WHEN v_estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO') THEN 'presupuesto'
    WHEN v_estado IN ('APROBADO', 'EN_REPARACION', 'ESPERANDO_REPUESTO', 'REPARADO') THEN 'costo_final'
    ELSE NULL
  END;

  IF v_campo IS NOT NULL THEN
    v_valor_actual := CASE WHEN v_campo = 'presupuesto' THEN v_presupuesto ELSE v_costo_final END;

    IF COALESCE(v_total_cobrado, 0) <= 0
       AND (v_valor_actual IS NULL OR ABS(v_valor_actual - v_suma_anterior) < 0.005)
    THEN
      IF v_suma_nueva <= 0 THEN
        v_nuevo_monto := NULL;
      ELSE
        v_nuevo_monto := ROUND(v_suma_nueva, 2);
      END IF;

      IF (v_nuevo_monto IS NULL OR v_nuevo_monto = 0)
         AND (
           (v_campo = 'costo_final' AND v_estado IN ('REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO'))
           OR (v_campo = 'presupuesto' AND v_estado = 'PRESUPUESTADO')
         )
      THEN
        NULL;
      ELSIF v_campo = 'presupuesto' THEN
        -- HUERFANO: un costo_final que coincide con la suma de lineas ANTERIOR
        -- lo escribio la regla previa a la 303, que sincronizaba siempre
        -- costo_final sin mirar el estado. La regla nueva ya no lo gobierna, asi
        -- que si no se limpia queda esperando a que alguien lleve la orden a
        -- REPARADO y termina siendo lo que se le cobra al cliente. Un numero
        -- tipeado por una persona NO coincide con la suma y no se toca.
        -- Se escribe en el MISMO UPDATE para no disparar dos veces el trigger de
        -- la 277.
        v_limpiar_huerfano := v_costo_final IS NOT NULL
          AND ABS(v_costo_final - v_suma_anterior) < 0.005;

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
    'success', true,
    'campoSincronizado', CASE WHEN v_actualizado THEN v_campo ELSE NULL END,
    'montoActualizado', v_actualizado,
    'costoFinalHuerfanoLimpiado', v_limpiar_huerfano,
    'costoFinalActualizado', v_actualizado AND v_campo = 'costo_final',
    'sumaServicios', v_suma_nueva
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- aplicar_monto_servicios_orden — el boton "Aplicar al total"
-- ============================================================
--
-- POR QUE NO VA POR EL PUT DE /api/ordenes/[id]
--
-- Ese PUT auto-transiciona la orden a PRESUPUESTADO al escribir presupuesto
-- (app/api/ordenes/[id]/route.ts:345-348) y encola la notificacion al cliente
-- (:505). Aplicar un monto calculado no es presupuestar: cambiar de estado y
-- avisarle al cliente tienen que seguir siendo actos explicitos del operador.
-- Esta funcion escribe la columna directo, igual que la sincronizacion
-- automatica, y por el mismo motivo.
--
-- La guarda de no bajar el monto por debajo de lo ya cobrado se mantiene: es la
-- que evita que estado_cobro pase a COBRADO y la deuda desaparezca.
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

  SELECT COALESCE(SUM(cantidad * precio_unitario), 0)
  INTO v_suma
  FROM servicios_orden
  WHERE orden_id = p_orden_id;

  -- === STATE GUARD — espejo de puedeAplicarMonto ===
  -- Escribir a mano no puede saltearse el gate que respeta la sincronizacion
  -- automatica. Dejar en null el costo_final de una orden ya REPARADA hace que
  -- entregar/route.ts lea pendiente = 0, saltee cargar_deuda_cuenta_corriente, y
  -- la deuda desaparezca de los cuatro lugares donde deberia figurar.
  -- Esta guarda faltaba en la 303: era el mismo bug 2b que el PR #254 habia
  -- cerrado para la ruta automatica, reabierto por la manual.
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

  -- Solo aplica a costo_final: presupuesto no es lo que se cobra.
  IF v_campo = 'costo_final' AND v_suma < COALESCE(v_total_cobrado, 0) THEN
    RETURN json_build_object(
      'error', 'El total de servicios es menor a lo ya cobrado en esta orden'
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

COMMENT ON FUNCTION agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC) IS
  'Inserta una linea en servicios_orden y sincroniza el monto VIVO de la orden (presupuesto antes de APROBADO, costo_final desde APROBADO) atomicamente, con FOR UPDATE sobre la orden. Espejo obligatorio de calcularMontoSincronizado en lib/servicios/sincronizar-costo-final.ts y de ESTADOS_COSTO_FINAL_BLOQUEADO / ESTADOS_PRESUPUESTO_BLOQUEADO en lib/orden-state-machine.ts: ver comentario de acoplamiento al inicio de la migracion 303.';

COMMENT ON FUNCTION eliminar_servicio_orden(TEXT, TEXT, TEXT) IS
  'Elimina una linea de servicios_orden y sincroniza el monto VIVO de la orden atomicamente. Mismo acoplamiento que agregar_servicio_orden: ver migracion 303.';

COMMENT ON FUNCTION aplicar_monto_servicios_orden(TEXT, TEXT) IS
  'Escribe la suma de las lineas de servicio en el monto vivo de la orden (boton "Aplicar al total"). Escribe la columna directo a proposito: el PUT de /api/ordenes/[id] auto-transiciona a PRESUPUESTADO y notifica al cliente, y aplicar un monto calculado no es presupuestar. Rechaza dejar costo_final por debajo de total_cobrado.';
