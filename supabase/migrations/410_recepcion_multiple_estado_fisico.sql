-- 410: la recepción múltiple registra el estado físico de cada equipo (diagrama de daños, 408).
--
-- Cada elemento de p_equipos puede traer ahora:
--   danos              JSONB array, la misma forma que registrar_estado_fisico_recepcion espera
--   recepcionSinDanos  BOOLEAN
-- Después de insertar cada orden, si el equipo trae pins o "sin daños", se llama a
-- registrar_estado_fisico_recepcion en la MISMA transacción: cualquier error (DANOS_*, CHECK)
-- aborta la recepción entera, sin órdenes sueltas.
--
-- Misma firma, SECURITY INVOKER y sin search_path como la definición viva (la llama
-- supabaseAdmin, service_role, que es quien puede ejecutar registrar_estado_fisico_recepcion).
-- CREATE OR REPLACE conserva los grants: no se tocan.
-- Basada en la definición VIVA de producción (pg_get_functiondef), no en 288.
-- Requiere 408 aplicada.

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
  v_danos        JSONB;
  v_sin_danos    BOOLEAN;
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

    -- (410) Estado físico del equipo al recibirlo: pins o "sin daños". Mismo RPC que el
    -- alta clásica (408), dentro de esta transacción: si falla, no queda ni la
    -- recepción ni ninguna de sus órdenes. Un equipo sin estado físico no lo llama.
    v_danos := CASE WHEN jsonb_typeof(v_equipo->'danos') = 'array' THEN v_equipo->'danos' ELSE '[]'::JSONB END;
    v_sin_danos := COALESCE((v_equipo->>'recepcionSinDanos')::BOOLEAN, FALSE);
    IF jsonb_array_length(v_danos) > 0 OR v_sin_danos THEN
      PERFORM public.registrar_estado_fisico_recepcion(v_orden_id, p_organization_id, v_danos, v_sin_danos, p_created_by);
    END IF;

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
