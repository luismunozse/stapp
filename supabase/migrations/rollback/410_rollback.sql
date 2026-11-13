-- Rollback of 410: restores the live crear_recepcion_multiple (without estado físico).
--
-- WHAT IS LOST: nothing stored. Pins and "sin daños" flags already registered stay in
-- orden_danos / ordenes_servicio; new multi-equipment receptions just stop registering them.
-- Run it only after the code that sends danos/recepcionSinDanos per equipo is reverted
-- (otherwise those fields are silently ignored). CREATE OR REPLACE keeps the grants.

CREATE OR REPLACE FUNCTION public.crear_recepcion_multiple(p_organization_id text, p_sucursal_id text, p_cliente_id text, p_equipos jsonb, p_firma_cliente text, p_firma_mime text, p_terminos boolean, p_recibido_por text, p_created_by text, p_telefono_contacto text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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

  -- (1) Número propio, independiente del contador de órdenes, vía contador
  -- atómico (evita el race de MAX+1 entre terminales concurrentes).
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

  -- (2) Una orden por equipo
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

    -- tipo_dispositivo es TEXT desde la migración 033: sin cast a enum
    INSERT INTO ordenes_servicio (
      numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
      recepcion_id, dispositivo, tipo_dispositivo, marca, color, imei,
      problema_reportado, accesorios, password_dispositivo, metadata,
      estado, public_token, recibido_por, telefono_contacto
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
$function$;
