-- ============================================================================
-- 278: RPC transaccional para la recepción múltiple
-- ============================================================================
-- Inserta la recepción y las N órdenes en UN commit. Si cualquier insert falla
-- (incluido el trigger update_ordenes_count cuando se excede el límite del
-- plan), rollbackea todo: nunca queda el cliente con 2 equipos cargados y 1 no.
--
-- Dos propiedades caen gratis de compartir una sola transacción:
--
-- 1. El trigger update_ordenes_count (167_atomic_plan_limit_enforcement.sql)
--    ya rollbackea toda la transacción cuando la organización supera el
--    límite de órdenes de su plan. Como todos los INSERT de este RPC viven
--    en una sola transacción, ese chequeo de límite queda atómico gratis:
--    no puede pasar "se crearon 2 equipos y el tercero falló".
--
-- 2. La firma del cliente se graba ACÁ, en la fila de recepciones, dentro de
--    esta misma transacción. El alta clásica (una orden por equipo) persiste
--    su firma en un segundo request no transaccional cuyos errores se
--    swallean — bug conocido. Este flujo no puede reproducirlo: o hay un
--    comprobante firmado, o no hay nada.
--
-- Los public_token se generan en la app y llegan por p_equipos, para no
-- depender de pgcrypto (gen_random_bytes) en la base.
--
-- tipo_dispositivo es TEXT desde la migración 033 (dejó de ser enum): no se
-- castea acá.
--
-- El número de recepción usa get_next_recepcion_number (277_recepcion_multiple.sql),
-- NO un SELECT MAX(numero)+1: dos terminales de mostrador de la misma
-- organización insertando a la vez leerían el mismo máximo y colisionarían
-- contra UNIQUE(organization_id, numero), mostrando un error crudo de base
-- de datos a quien está parado en el mostrador. get_next_recepcion_number
-- toma row lock sobre el contador de la organización y serializa a los
-- llamadores concurrentes.
-- ============================================================================

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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_recepcion_multiple IS
  'Crea una recepción y sus N órdenes en una sola transacción. Rollback total ante cualquier fallo, incluido el límite de órdenes del plan.';
