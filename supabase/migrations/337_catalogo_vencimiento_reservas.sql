-- 337: vencimiento automatico de las reservas del catalogo publico.
--
-- La 315 dejo explicito que NO cerraba el abandono: una solicitud que nadie
-- responde retiene stock para siempre. Esta migracion lo cierra siguiendo el
-- diseño que la 315 anticipo: barrera para no acreditar cotizaciones
-- historicas, lotes para no morir por timeout, y no soltarle la reserva a una
-- orden en curso.
--
-- Aditiva y re-ejecutable. Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una
-- transaccion propia). La columna nueva tiene DEFAULT constante: en Postgres 11+
-- no reescribe la tabla.
--
-- Partes:
--   1. catalogo_config.reserva_horas (48 por defecto, 1..720).
--   2. expirar_reservas_catalogo(p_limite): libera reservas vencidas. La
--      cotizacion NO cambia de estado (sigue ENVIADA): solo se devuelve el stock.
--   3. retomar_reserva_catalogo_vencida(p_cotizacion_id): si una solicitud vencida
--      igual se acepta o se convierte en venta, vuelve a descontar las clases B/C
--      (validando stock). Ver "CONVERSION DESPUES DEL VENCIMIENTO".
--   4. convertir_cotizacion_venta_atomica: redefinicion de la 327 (misma firma).
--   5. trigger: retomar al pasar a ACEPTADA.
--
-- ============================================================
-- CONVERSION DESPUES DEL VENCIMIENTO (lo que se verifico en las funciones)
-- ============================================================
-- Clase A (inventario.stock_reservado). liberar_reserva_catalogo asienta un
-- LIBERACION_RESERVA en movimientos_inventario, asi que reserva_cotizacion_
-- pendiente da 0 para la cotizacion vencida. El problema estaba en la
-- conversion: convertir_cotizacion_venta_atomica (327) llamaba a
-- liberar_items_cotizacion, que libera LEAST(cantidad de la linea,
-- stock_reservado) SIN netear contra el libro. Tras el vencimiento eso libera
-- por SEGUNDA vez: stock_reservado es un contador global por producto, asi que
-- se come la reserva de OTRA cotizacion (no baja de 0 por el LEAST, pero la
-- otra queda sin respaldo). Fix: para cotizaciones del catalogo la conversion
-- libera por el libro (liberar_reserva_catalogo), que devuelve exactamente lo
-- pendiente: 0 si ya vencio. Tambien corrige el caso de un admin que edito la
-- cantidad de la linea. Las que no son del catalogo siguen igual.
-- Aprobar una solicitud vencida ya se comportaba bien: aprobar_cotizacion_
-- atomica -> reservar_items_cotizacion reserva el FALTANTE contra el libro
-- (0 pendiente => reserva todo) y valida stock.
--
-- Clases B y C (catalogo_variantes.stock / catalogo_items.stock). El vencimiento
-- las RESTITUYE. Pero la venta no las toca nunca (crear_venta_atomica solo
-- mueve inventario): la 315 resolvia eso cerrando la reserva sin devolver
-- ("la venta se quedo el stock"). Con el stock ya restituido, nadie lo volvia a
-- descontar: la mercaderia salia y el catalogo seguia contandola. Fix:
-- retomar_reserva_catalogo_vencida descuenta de nuevo, VALIDA stock (si ya no
-- alcanza, la conversion/aprobacion falla con un mensaje claro y rollbackea) y
-- abre una reserva nueva en el libro, de modo que rechazar despues vuelva a
-- restituir y convertir la consuma.
--
-- Rechazar / borrar una solicitud ya vencida: el trigger de la 315 llama a
-- liberar_reserva_catalogo, que no encuentra nada abierto (A neteado a 0, B/C
-- con liberada_at) y es no-op: no hay doble acreditacion.
--
-- Rutas que lo ejercitan: PUT /api/cotizaciones/[id] (rechazo), DELETE,
-- /api/public/cotizaciones/[token]/aprobar y /rechazar, convertir-venta.

-- ============================================================
-- Parte 1: configuracion por organizacion
-- ============================================================
ALTER TABLE catalogo_config
  ADD COLUMN IF NOT EXISTS reserva_horas INTEGER NOT NULL DEFAULT 48
    CONSTRAINT catalogo_config_reserva_horas_chk CHECK (reserva_horas BETWEEN 1 AND 720);

COMMENT ON COLUMN catalogo_config.reserva_horas IS
  'Horas que una solicitud pendiente del catalogo retiene stock antes de que expirar_reservas_catalogo lo libere. v337.';

-- ============================================================
-- Parte 2: expirar_reservas_catalogo
-- ============================================================
-- Criterios (todos a la vez):
--   * origen CATALOGO_PUBLICO, estado ENVIADA. BORRADOR no: las solicitudes del
--     catalogo nacen ENVIADA, asi que un BORRADOR es una edicion del taller en
--     curso y no se le suelta la reserva. ACEPTADA tampoco: el taller ya se
--     comprometio.
--   * deleted_at IS NULL y reemplazada_por IS NULL (liberar_reserva_catalogo
--     tambien omite las reemplazadas: su stock lo debe la revision).
--   * No convertida: sin venta_id, convertida_a_orden_id ni orden_id. Una orden
--     en curso conserva su reserva.
--   * Con reserva abierta: A (reserva_cotizacion_pendiente) o B/C (libro del
--     catalogo con liberada_at NULL).
--   * created_at < now() - reserva_horas de SU organizacion (48 si no hay config).
--   * BARRERA: created_at >= v_barrera. Es el instante en que se mergeo la 315
--     (2026-08-28 13:34 -03): antes no existe libro de reservas (el catalogo
--     descontaba stock duro), asi que acreditar esas cotizaciones inventaria
--     stock. Ajustable aca si la 315 se aplico mas tarde.
-- Lotes: LIMIT p_limite con FOR UPDATE SKIP LOCKED, asi un rechazo del admin en
-- paralelo no bloquea el barrido ni se pisa con el.
CREATE OR REPLACE FUNCTION expirar_reservas_catalogo(p_limite INT DEFAULT 200)
RETURNS JSONB AS $$
DECLARE
  v_barrera   CONSTANT TIMESTAMPTZ := '2026-08-28 16:34:12+00';
  v_cot       RECORD;
  v_res       JSONB;
  v_revisadas INT := 0;
  v_liberadas INT := 0;
  v_items     INT := 0;
  v_catalogo  INT := 0;
BEGIN
  IF p_limite IS NULL OR p_limite < 1 THEN
    p_limite := 200;
  END IF;

  FOR v_cot IN
    SELECT c.id
    FROM cotizaciones c
    WHERE c.origen = 'CATALOGO_PUBLICO'
      AND c.estado::TEXT = 'ENVIADA'
      AND c.deleted_at IS NULL
      AND c.reemplazada_por IS NULL
      AND c.venta_id IS NULL
      AND c.convertida_a_orden_id IS NULL
      AND c.orden_id IS NULL
      AND c.created_at >= v_barrera
      AND c.created_at < now() - make_interval(hours => COALESCE(
            (SELECT cc.reserva_horas FROM catalogo_config cc
              WHERE cc.organization_id = c.organization_id), 48))
      AND (
        EXISTS (SELECT 1 FROM catalogo_reservas_cotizacion r
                 WHERE r.cotizacion_id = c.id AND r.liberada_at IS NULL)
        OR EXISTS (SELECT 1 FROM reserva_cotizacion_pendiente(c.id))
      )
    ORDER BY c.created_at
    LIMIT p_limite
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_res := liberar_reserva_catalogo(v_cot.id, 'vencida');
    v_revisadas := v_revisadas + 1;
    v_items     := v_items + COALESCE((v_res->>'itemsLiberados')::INT, 0);
    v_catalogo  := v_catalogo + COALESCE((v_res->>'itemsCatalogoRestaurados')::INT, 0);
    IF COALESCE((v_res->>'itemsLiberados')::INT, 0)
       + COALESCE((v_res->>'itemsCatalogoRestaurados')::INT, 0) > 0 THEN
      v_liberadas := v_liberadas + 1;
    END IF;
  END LOOP;

  -- revisadas > liberadas = cotizaciones que siguen "abiertas" sin que haya
  -- nada que devolver (p. ej. stock_reservado ya en 0). Se reintentan en cada
  -- corrida; el cron lo muestra para detectarlas.
  RETURN jsonb_build_object(
    'ok', true,
    'revisadas', v_revisadas,
    'liberadas', v_liberadas,
    'itemsLiberados', v_items,
    'itemsCatalogoRestaurados', v_catalogo
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION expirar_reservas_catalogo(INT) IS
  'Libera la reserva de solicitudes ENVIADA del catalogo mas viejas que catalogo_config.reserva_horas, en lotes. No cambia el estado de la cotizacion. v337.';

REVOKE EXECUTE ON FUNCTION expirar_reservas_catalogo(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expirar_reservas_catalogo(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION expirar_reservas_catalogo(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION expirar_reservas_catalogo(INT) TO service_role;

-- ============================================================
-- Parte 3: retomar_reserva_catalogo_vencida
-- ============================================================
-- Vuelve a descontar las reservas B/C que el vencimiento restituyo. Se llama al
-- aceptar la solicitud o al convertirla en venta. Idempotente: la fila vencida
-- se marca 'vencida-retomada' y la reserva nueva queda abierta como cualquier
-- otra. Incluye la cotizacion que esta revisa (mismo salto que
-- consumir_reserva_catalogo).
CREATE OR REPLACE FUNCTION retomar_reserva_catalogo_vencida(p_cotizacion_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_row   RECORD;
  v_stock INTEGER;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT r.id, r.cotizacion_id, r.organization_id, r.catalogo_item_id, r.variante_id, r.cantidad
    FROM catalogo_reservas_cotizacion r
    WHERE r.motivo = 'vencida'
      AND r.liberada_at IS NOT NULL
      AND r.cotizacion_id IN (
        SELECT p_cotizacion_id
        UNION
        SELECT c.revision_de FROM cotizaciones c
          WHERE c.id = p_cotizacion_id AND c.revision_de IS NOT NULL
      )
    FOR UPDATE
  LOOP
    IF v_row.variante_id IS NOT NULL THEN
      SELECT stock INTO v_stock FROM catalogo_variantes WHERE id = v_row.variante_id FOR UPDATE;
    ELSE
      SELECT stock INTO v_stock FROM catalogo_items WHERE id = v_row.catalogo_item_id FOR UPDATE;
    END IF;

    -- Destino borrado o sin control de stock (NULL): no hay nada que descontar.
    IF FOUND AND v_stock IS NOT NULL THEN
      IF v_stock < v_row.cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente: la reserva de esta solicitud del catálogo venció y ya no quedan unidades suficientes (disponible: %, necesario: %)',
          v_stock, v_row.cantidad USING ERRCODE = 'P0003';
      END IF;

      IF v_row.variante_id IS NOT NULL THEN
        UPDATE catalogo_variantes SET stock = stock - v_row.cantidad WHERE id = v_row.variante_id;
      ELSE
        UPDATE catalogo_items SET stock = stock - v_row.cantidad WHERE id = v_row.catalogo_item_id;
      END IF;

      INSERT INTO catalogo_reservas_cotizacion
        (cotizacion_id, organization_id, catalogo_item_id, variante_id, cantidad)
      VALUES
        (v_row.cotizacion_id, v_row.organization_id, v_row.catalogo_item_id, v_row.variante_id, v_row.cantidad);
    END IF;

    UPDATE catalogo_reservas_cotizacion SET motivo = 'vencida-retomada' WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'itemsRetomados', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION retomar_reserva_catalogo_vencida(TEXT) IS
  'Re-descuenta (validando stock) las reservas B/C que expirar_reservas_catalogo restituyo, cuando la solicitud se acepta o convierte. v337.';

REVOKE EXECUTE ON FUNCTION retomar_reserva_catalogo_vencida(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION retomar_reserva_catalogo_vencida(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION retomar_reserva_catalogo_vencida(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION retomar_reserva_catalogo_vencida(TEXT) TO service_role;

-- ============================================================
-- Parte 4: convertir_cotizacion_venta_atomica (327 + fix de vencimiento)
-- ============================================================
-- Misma firma que la 327/315. Unico cambio: el bloque final, por origen.
CREATE OR REPLACE FUNCTION convertir_cotizacion_venta_atomica(
  p_org_id                  TEXT,
  p_vendedor_id             TEXT,
  p_cliente_id              TEXT,
  p_cliente_nombre          TEXT,
  p_cliente_telefono        TEXT,
  p_subtotal                DECIMAL,
  p_descuento               DECIMAL,
  p_tipo_descuento          TEXT,
  p_porcentaje_descuento    DECIMAL,
  p_total                   DECIMAL,
  p_metodo_pago             TEXT,
  p_observaciones           TEXT,
  p_numero_referencia       TEXT,
  p_cuotas                  INTEGER,
  p_recargo_porcentaje      DECIMAL,
  p_monto_original          DECIMAL,
  p_items                   JSONB,
  p_pagos                   JSONB    DEFAULT NULL,
  p_idempotency_key         TEXT     DEFAULT NULL,
  p_deposito_id             TEXT     DEFAULT NULL,
  p_sucursal_id             TEXT     DEFAULT NULL,
  p_cotizacion_id           TEXT     DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result        JSONB;
  v_venta_previa  TEXT;
  v_estado_previa TEXT;
  v_origen        TEXT;
BEGIN
  IF p_cotizacion_id IS NOT NULL THEN
    SELECT venta_id, origen INTO v_venta_previa, v_origen
    FROM cotizaciones
    WHERE id = p_cotizacion_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cotizacion no encontrada';
    END IF;

    IF v_venta_previa IS NOT NULL THEN
      SELECT estado::text INTO v_estado_previa
      FROM ventas
      WHERE id = v_venta_previa AND organization_id = p_org_id;

      IF v_estado_previa IS NOT NULL AND v_estado_previa <> 'ANULADA' THEN
        RAISE EXCEPTION 'COTIZACION_YA_CONVERTIDA: %', v_venta_previa
          USING ERRCODE = 'P0020';
      END IF;
    END IF;
  END IF;

  v_result := crear_venta_atomica(
    p_org_id, p_vendedor_id, p_cliente_id, p_cliente_nombre, p_cliente_telefono,
    p_subtotal, p_descuento, p_tipo_descuento, p_porcentaje_descuento, p_total,
    p_metodo_pago, p_observaciones, p_numero_referencia, p_cuotas,
    p_recargo_porcentaje, p_monto_original, p_items, p_pagos,
    p_idempotency_key, p_deposito_id, p_sucursal_id
  );

  IF p_cotizacion_id IS NOT NULL THEN
    -- B/C vencidas: la venta no las descuenta, asi que se vuelven a tomar (y
    -- validar) antes de cerrarlas. No-op si la reserva nunca vencio.
    PERFORM retomar_reserva_catalogo_vencida(p_cotizacion_id);

    -- B/C vigentes: cerrar SIN devolver, la venta se quedo el stock.
    PERFORM consumir_reserva_catalogo(
      p_cotizacion_id, 'Reserva consumida por conversión a venta');

    IF v_origen = 'CATALOGO_PUBLICO' THEN
      -- Clase A por el LIBRO: libera exactamente lo pendiente (0 si ya vencio).
      -- liberar_items_cotizacion liberaria la cantidad de la linea sin netear y,
      -- tras el vencimiento, se comeria la reserva de otra cotizacion.
      PERFORM liberar_reserva_catalogo(
        p_cotizacion_id, 'Reserva consumida por conversión a venta');
    ELSE
      PERFORM liberar_items_cotizacion(
        p_cotizacion_id, p_vendedor_id, 'Reserva consumida por conversión a venta');
    END IF;

    UPDATE cotizaciones
    SET venta_id = v_result->>'ventaId'
    WHERE id = p_cotizacion_id AND organization_id = p_org_id;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Parte 5: trigger al aceptar
-- ============================================================
CREATE OR REPLACE FUNCTION trg_retomar_reserva_catalogo()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM retomar_reserva_catalogo_vencida(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cotizaciones_retomar_reserva_catalogo ON cotizaciones;

CREATE TRIGGER cotizaciones_retomar_reserva_catalogo
  AFTER UPDATE ON cotizaciones
  FOR EACH ROW
  WHEN (NEW.origen = 'CATALOGO_PUBLICO'
        AND NEW.estado::TEXT = 'ACEPTADA' AND OLD.estado::TEXT IS DISTINCT FROM 'ACEPTADA')
  EXECUTE FUNCTION trg_retomar_reserva_catalogo();
