-- ============================================================================
-- 421: el presupuesto (cotizacion) y las lineas de la orden suman sin duplicar
-- ============================================================================
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el codigo. El codigo viejo
-- sigue funcionando con la migracion aplicada (el parametro nuevo de
-- agregar_servicio_orden tiene default y las columnas nuevas tambien).
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/421_...sql
-- (dry-run por defecto, --apply para confirmar). Sin BEGIN/COMMIT a proposito.
--
-- PROBLEMA (orden 82, 2026-11-23)
-- Dos caminos escriben el monto vivo de la orden y se pisan:
--   - las rutas de cotizaciones escriben presupuesto = costo_final = total de
--     las cotizaciones vigentes (ignoran servicios y repuestos);
--   - la 420 sincroniza con servicios + repuestos (ignora las cotizaciones).
-- Un servicio FRP de 25000 + una cotizacion con el pin de 35000 terminaba
-- cobrando 35000.
--
-- Sumar todo no sirve: en prod ~55 de 60 ordenes con cotizacion cargan LOS
-- MISMOS items tambien como repuestos/servicios (la cotizacion es lo que ve el
-- cliente; la pestana Repuestos, el stock y el costo). Sumar duplicaria.
--
-- REGLA (elegida por el usuario)
-- Cada linea dice si ya esta dentro del presupuesto: incluido_en_presupuesto.
--   - Con alguna cotizacion vigente: total = cotizaciones vigentes + lineas
--     NO incluidas.
--   - Sin cotizacion vigente: total = todas las lineas (lo de la 420). Una
--     linea marcada como incluida vuelve a contar si la cotizacion se borra o
--     se rechaza: ya no hay nada que la incluya.
-- Cotizacion vigente = misma definicion que cotizacionesVigentesDeOrden
-- (lib/cotizacion-presupuesto.ts): no borrada, no reemplazada, no RECHAZADA.
--
-- DATOS EXISTENTES
-- Las lineas de ordenes que hoy tienen cotizacion vigente se marcan como
-- incluidas: es lo que el monto de esas ordenes ya refleja (lo escribio la
-- cotizacion). No se reescribe ningun monto. La orden 82 se corrige desde la
-- pantalla marcando el FRP como "suma al cobro".
--
-- VERIFICACION POSTERIOR:
--   SELECT column_name FROM information_schema.columns
--    WHERE column_name = 'incluido_en_presupuesto';                 -- 2 filas
--   SELECT suma_lineas_orden(id) FROM ordenes_servicio LIMIT 1;    -- no falla
--   SELECT count(*) FROM pg_proc WHERE proname = 'agregar_servicio_orden'; -- 1
-- ----------------------------------------------------------------------------

ALTER TABLE servicios_orden
  ADD COLUMN IF NOT EXISTS incluido_en_presupuesto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE repuestos_orden
  ADD COLUMN IF NOT EXISTS incluido_en_presupuesto BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN servicios_orden.incluido_en_presupuesto IS
  'TRUE: la linea ya esta dentro de una cotizacion vigente de la orden y no suma aparte al cobro. Sin cotizacion vigente no tiene efecto. Ver migracion 421.';
COMMENT ON COLUMN repuestos_orden.incluido_en_presupuesto IS
  'TRUE: el repuesto ya esta dentro de una cotizacion vigente de la orden y no suma aparte al cobro (sigue contando para stock y costo). Sin cotizacion vigente no tiene efecto. Ver migracion 421.';

CREATE OR REPLACE FUNCTION orden_tiene_cotizacion_vigente(p_orden_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM cotizaciones
    WHERE orden_id = p_orden_id
      AND deleted_at IS NULL
      AND reemplazada_por IS NULL
      AND estado::text <> 'RECHAZADA'
  );
$$ LANGUAGE sql STABLE;

-- Backfill ANTES de redefinir el trigger de repuestos: el trigger viejo no
-- mira esta columna, asi que el UPDATE no toca ningun monto.
UPDATE servicios_orden SET incluido_en_presupuesto = TRUE
WHERE NOT incluido_en_presupuesto AND orden_tiene_cotizacion_vigente(orden_id);
UPDATE repuestos_orden SET incluido_en_presupuesto = TRUE
WHERE NOT incluido_en_presupuesto AND orden_tiene_cotizacion_vigente(orden_id);

-- Mismo nombre que en la 420 a proposito: todo lo que ya la usa (la regla de
-- sincronizacion, "Aplicar al total", el trigger) pasa a ver el total nuevo.
CREATE OR REPLACE FUNCTION suma_lineas_orden(p_orden_id TEXT)
RETURNS NUMERIC AS $$
  WITH cot AS (SELECT orden_tiene_cotizacion_vigente(p_orden_id) AS hay)
  SELECT ROUND(
    CASE WHEN (SELECT hay FROM cot) THEN
      COALESCE((SELECT SUM(total) FROM cotizaciones
                 WHERE orden_id = p_orden_id
                   AND deleted_at IS NULL
                   AND reemplazada_por IS NULL
                   AND estado::text <> 'RECHAZADA'), 0)
    ELSE 0 END
    + COALESCE((SELECT SUM(cantidad * precio_unitario)
                  FROM servicios_orden
                 WHERE orden_id = p_orden_id
                   AND NOT (incluido_en_presupuesto AND (SELECT hay FROM cot))), 0)
    + COALESCE((SELECT SUM(cantidad * COALESCE(precio_venta_unitario, precio_unitario, 0))
                  FROM repuestos_orden
                 WHERE orden_id = p_orden_id
                   AND NOT (incluido_en_presupuesto AND (SELECT hay FROM cot))), 0)
  , 2);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION suma_lineas_orden(TEXT) IS
  'Monto calculado de la orden: cotizaciones vigentes + servicios y repuestos que no estan incluidos en ellas (sin cotizacion vigente, todas las lineas). Espejo de sumaLineasOrden en lib/servicios/suma-lineas-orden.ts. Ver migraciones 420 y 421.';

-- agregar_servicio_orden gana p_incluido_en_presupuesto. Con otra firma
-- CREATE OR REPLACE crearia una sobrecarga y las llamadas con 6 argumentos
-- quedarian ambiguas: se borra la vieja. El default mantiene funcionando al
-- codigo anterior durante el despliegue.
DROP FUNCTION IF EXISTS agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC);

CREATE OR REPLACE FUNCTION agregar_servicio_orden(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_servicio_id TEXT,
  p_nombre TEXT,
  p_cantidad INTEGER,
  p_precio_unitario NUMERIC,
  p_incluido_en_presupuesto BOOLEAN DEFAULT FALSE
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
  INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario, incluido_en_presupuesto)
  VALUES (p_orden_id, p_servicio_id, p_nombre, p_cantidad, p_precio_unitario, COALESCE(p_incluido_en_presupuesto, FALSE))
  RETURNING * INTO v_linea;

  v_sync := sincronizar_monto_lineas_orden(p_orden_id, v_suma_anterior);

  RETURN json_build_object(
    'success', true,
    'id', v_linea.id,
    'servicio_id', v_linea.servicio_id,
    'nombre', v_linea.nombre,
    'cantidad', v_linea.cantidad,
    'precio_unitario', v_linea.precio_unitario,
    'incluido_en_presupuesto', v_linea.incluido_en_presupuesto,
    'campoSincronizado', v_sync->'campoSincronizado',
    'montoActualizado', (v_sync->>'montoActualizado')::boolean,
    'costoFinalHuerfanoLimpiado', (v_sync->>'costoFinalHuerfanoLimpiado')::boolean,
    'costoFinalActualizado', (v_sync->>'costoFinalActualizado')::boolean,
    'sumaServicios', (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) FROM servicios_orden WHERE orden_id = p_orden_id),
    'sumaLineas', (v_sync->>'sumaLineas')::numeric
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, BOOLEAN) IS
  'Inserta una linea en servicios_orden (incluida o no en el presupuesto) y sincroniza el monto VIVO de la orden con suma_lineas_orden, con FOR UPDATE sobre la orden. Ver migraciones 303, 304, 420 y 421.';

-- Marcar un servicio como incluido / que suma. Misma regla que el alta: la
-- suma anterior se lee antes del cambio, con la orden bloqueada.
CREATE OR REPLACE FUNCTION marcar_servicio_incluido_presupuesto(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_servicio_orden_id TEXT,
  p_incluido BOOLEAN
)
RETURNS JSON AS $$
DECLARE
  v_suma_anterior NUMERIC;
  v_filas INTEGER;
  v_sync JSON;
BEGIN
  PERFORM 1 FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  v_suma_anterior := suma_lineas_orden(p_orden_id);

  UPDATE servicios_orden SET incluido_en_presupuesto = p_incluido
  WHERE id = p_servicio_orden_id AND orden_id = p_orden_id;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  IF v_filas = 0 THEN
    RETURN json_build_object('error', 'Linea no encontrada');
  END IF;

  v_sync := sincronizar_monto_lineas_orden(p_orden_id, v_suma_anterior);

  RETURN json_build_object(
    'success', true,
    'campoSincronizado', v_sync->'campoSincronizado',
    'montoActualizado', (v_sync->>'montoActualizado')::boolean,
    'sumaLineas', (v_sync->>'sumaLineas')::numeric
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION marcar_servicio_incluido_presupuesto(TEXT, TEXT, TEXT, BOOLEAN) IS
  'Cambia servicios_orden.incluido_en_presupuesto y sincroniza el monto vivo de la orden (regla 303/304). Ver migracion 421.';

-- Trigger de repuestos: igual que en la 420, pero el aporte de una fila es 0
-- si esta incluida y la orden tiene cotizacion vigente. Escucha tambien la
-- columna nueva, asi marcar/desmarcar un repuesto mueve el monto.
CREATE OR REPLACE FUNCTION trg_repuestos_orden_sincroniza_monto()
RETURNS TRIGGER AS $$
DECLARE
  v_aporte_old NUMERIC := 0;
  v_aporte_new NUMERIC := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_aporte_old := CASE
      WHEN OLD.incluido_en_presupuesto AND orden_tiene_cotizacion_vigente(OLD.orden_id) THEN 0
      ELSE OLD.cantidad * COALESCE(OLD.precio_venta_unitario, OLD.precio_unitario, 0)
    END;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_aporte_new := CASE
      WHEN NEW.incluido_en_presupuesto AND orden_tiene_cotizacion_vigente(NEW.orden_id) THEN 0
      ELSE NEW.cantidad * COALESCE(NEW.precio_venta_unitario, NEW.precio_unitario, 0)
    END;
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
    RETURN NULL; -- no cambio el importe que suma (p. ej. se movio de deposito)
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
  AFTER INSERT OR DELETE OR UPDATE OF cantidad, precio_unitario, precio_venta_unitario, orden_id, incluido_en_presupuesto
  ON repuestos_orden
  FOR EACH ROW
  EXECUTE FUNCTION trg_repuestos_orden_sincroniza_monto();

NOTIFY pgrst, 'reload schema';
