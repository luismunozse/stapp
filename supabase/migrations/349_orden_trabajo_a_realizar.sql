-- 349: "Trabajo a realizar" en la orden de ingreso.
--
-- El comprobante de recepción ahora muestra, además de la falla declarada, el
-- trabajo que el taller planea hacer (texto libre: "Cambio de pantalla +
-- batería"). Es opcional: NULL = no se completó y el comprobante omite la fila.
--
-- Aditiva y re-ejecutable. Columna nullable sin DEFAULT: no reescribe la tabla.
-- RLS: sin cambios, la columna hereda las políticas por fila de ordenes_servicio.
--
-- También se reemplaza crear_recepcion_multiple (288) para que la recepción
-- múltiple persista el campo por equipo. Es CREATE OR REPLACE con la misma
-- firma: el cuerpo es idéntico al de 288 salvo la columna nueva. Una app que
-- mande la clave `trabajoARealizar` antes de aplicar esto no rompe nada: la
-- versión vieja de la función ignora claves JSON que no conoce.
-- Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una transacción propia).

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS trabajo_a_realizar text;

CREATE OR REPLACE FUNCTION crear_recepcion_multiple(
  p_organization_id   TEXT,
  p_sucursal_id       TEXT,
  p_cliente_id        TEXT,
  p_equipos           JSONB,
  p_firma_cliente     TEXT,
  p_firma_mime        TEXT,
  p_terminos          BOOLEAN,
  p_recibido_por      TEXT,
  p_created_by        TEXT,
  p_telefono_contacto TEXT DEFAULT NULL,
  p_observaciones     TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_recepcion_id TEXT;
  v_numero       INTEGER;
  v_codigo       TEXT;
  v_equipo       JSONB;
  v_orden_id     TEXT;
  v_numero_orden INTEGER;
  v_codigo_orden TEXT;
  v_prefijo      TEXT;
  v_ordenes      JSONB := '[]'::JSONB;
BEGIN
  IF p_equipos IS NULL OR jsonb_array_length(p_equipos) < 2 THEN
    RAISE EXCEPTION 'recepcion_multiple: se requieren al menos 2 equipos';
  END IF;

  v_numero := get_next_recepcion_number(p_organization_id);
  v_codigo := 'REC' || LPAD(v_numero::TEXT, 3, '0');

  INSERT INTO recepciones (
    organization_id, sucursal_id, cliente_id, numero, codigo,
    firma_cliente, firma_mime, terminos_aceptados,
    recibido_por, observaciones, created_by
  ) VALUES (
    p_organization_id, p_sucursal_id, p_cliente_id, v_numero, v_codigo,
    p_firma_cliente, p_firma_mime, COALESCE(p_terminos, FALSE),
    p_recibido_por, p_observaciones, p_created_by
  ) RETURNING id INTO v_recepcion_id;

  FOR v_equipo IN SELECT * FROM jsonb_array_elements(p_equipos)
  LOOP
    IF COALESCE(v_equipo->>'publicToken', '') = '' THEN
      RAISE EXCEPTION 'recepcion_multiple: publicToken faltante para el equipo %', v_equipo->>'dispositivo';
    END IF;

    SELECT prefijo_orden INTO v_prefijo
    FROM tipos_dispositivo
    WHERE organization_id = p_organization_id
      AND codigo = (v_equipo->>'tipoDispositivo')
      AND activo = TRUE
    LIMIT 1;

    v_prefijo := COALESCE(v_prefijo, 'ORD');
    v_numero_orden := get_next_order_number(p_organization_id);
    v_codigo_orden := v_prefijo || LPAD(v_numero_orden::TEXT, 3, '0');

    INSERT INTO ordenes_servicio (
      numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
      recepcion_id, dispositivo, tipo_dispositivo, marca, color, imei,
      problema_reportado, trabajo_a_realizar, accesorios, password_dispositivo,
      metadata, estado, public_token, recibido_por, telefono_contacto
    ) VALUES (
      v_numero_orden,
      v_codigo_orden,
      p_cliente_id,
      p_organization_id,
      p_sucursal_id,
      v_recepcion_id,
      v_equipo->>'dispositivo',
      v_equipo->>'tipoDispositivo',
      NULLIF(v_equipo->>'marca', ''),
      NULLIF(v_equipo->>'color', ''),
      NULLIF(v_equipo->>'imei', ''),
      v_equipo->>'problemaReportado',
      NULLIF(v_equipo->>'trabajoARealizar', ''),
      NULLIF(v_equipo->>'accesorios', ''),
      NULLIF(v_equipo->>'codigoAccesoDispositivo', ''),
      COALESCE(v_equipo->'metadata', '{}'::JSONB),
      'RECIBIDO',
      v_equipo->>'publicToken',
      p_recibido_por,
      p_telefono_contacto
    ) RETURNING id INTO v_orden_id;

    v_ordenes := v_ordenes || jsonb_build_object(
      'id',          v_orden_id,
      'numeroOrden', v_numero_orden,
      'codigoOrden', v_codigo_orden,
      'dispositivo', v_equipo->>'dispositivo',
      'publicToken', v_equipo->>'publicToken'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'recepcion', jsonb_build_object('id', v_recepcion_id, 'numero', v_numero, 'codigo', v_codigo),
    'ordenes',   v_ordenes
  );
END;
$$ LANGUAGE plpgsql;
