-- Rollback de la 421: vuelve a suma_lineas_orden, agregar_servicio_orden y el
-- trigger de repuestos de la 420. Las columnas incluido_en_presupuesto se
-- borran (se pierde la marca de cada linea). Correr ANTES de revertir el
-- codigo que manda p_incluido_en_presupuesto.

DROP TRIGGER IF EXISTS repuestos_orden_sincroniza_monto ON repuestos_orden;

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
    PERFORM 1 FROM ordenes_servicio WHERE id = OLD.orden_id FOR UPDATE;
    PERFORM sincronizar_monto_lineas_orden(OLD.orden_id, suma_lineas_orden(OLD.orden_id) + ROUND(v_aporte_old, 2));
    PERFORM 1 FROM ordenes_servicio WHERE id = NEW.orden_id FOR UPDATE;
    PERFORM sincronizar_monto_lineas_orden(NEW.orden_id, suma_lineas_orden(NEW.orden_id) - ROUND(v_aporte_new, 2));
    RETURN NULL;
  END IF;

  IF ABS(v_aporte_new - v_aporte_old) < 0.005 THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM ordenes_servicio WHERE id = COALESCE(NEW.orden_id, OLD.orden_id) FOR UPDATE;
  PERFORM sincronizar_monto_lineas_orden(
    COALESCE(NEW.orden_id, OLD.orden_id),
    suma_lineas_orden(COALESCE(NEW.orden_id, OLD.orden_id)) - ROUND(v_aporte_new - v_aporte_old, 2)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repuestos_orden_sincroniza_monto
  AFTER INSERT OR DELETE OR UPDATE OF cantidad, precio_unitario, precio_venta_unitario, orden_id
  ON repuestos_orden
  FOR EACH ROW
  EXECUTE FUNCTION trg_repuestos_orden_sincroniza_monto();

DROP FUNCTION IF EXISTS marcar_servicio_incluido_presupuesto(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, BOOLEAN);

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
  PERFORM 1 FROM ordenes_servicio
  WHERE id = p_orden_id AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  v_suma_anterior := suma_lineas_orden(p_orden_id);

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

CREATE OR REPLACE FUNCTION suma_lineas_orden(p_orden_id TEXT)
RETURNS NUMERIC AS $$
  SELECT ROUND(
    COALESCE((SELECT SUM(cantidad * precio_unitario)
                FROM servicios_orden WHERE orden_id = p_orden_id), 0)
    + COALESCE((SELECT SUM(cantidad * COALESCE(precio_venta_unitario, precio_unitario, 0))
                  FROM repuestos_orden WHERE orden_id = p_orden_id), 0)
  , 2);
$$ LANGUAGE sql STABLE;

DROP FUNCTION IF EXISTS orden_tiene_cotizacion_vigente(TEXT);

ALTER TABLE servicios_orden DROP COLUMN IF EXISTS incluido_en_presupuesto;
ALTER TABLE repuestos_orden DROP COLUMN IF EXISTS incluido_en_presupuesto;

NOTIFY pgrst, 'reload schema';
