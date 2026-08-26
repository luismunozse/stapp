-- 314_catalogo_reserva_en_vez_de_descuento.sql
--
-- El catálogo público llevaba contabilidad de stock PARALELA. Al crear una
-- solicitud, reservar_stock_catalogo hacía (239:99-101):
--
--     UPDATE inventario SET stock = GREATEST(0, stock - v_cantidad)
--
-- Un descuento físico real, sin pasar por descontar_stock_deposito (el detalle
-- por depósito quedaba desincronizado) y sin asiento en movimientos_inventario
-- (la unidad desaparecía sin rastro en el historial del producto).
--
-- Dos consecuencias, la segunda peor que la primera:
--
--   1. DOBLE DESCUENTO. Si esa cotización termina convertida en venta,
--      crear_venta_atomica descuenta inventario.stock otra vez: la misma unidad
--      sale dos veces del stock. Camino alcanzable hoy: la cotización nace
--      PRESUPUESTO/ENVIADA, un admin le carga equipo_snapshot, la convierte a
--      orden (que le cambia el tipo a ORDEN), la aprueba — ahí
--      reservar_items_cotizacion reserva ADEMÁS — y la convierte a venta.
--
--   2. DESCUENTO PERMANENTE ANTE ABANDONO. Nada devuelve ese stock. Rechazar,
--      borrar o simplemente ignorar la solicitud no dispara ninguna
--      devolución, y liberar_items_cotizacion solo toca stock_reservado —
--      una columna que el catálogo nunca escribía. O sea: cualquiera desde
--      internet podía vaciar el stock declarado de un local sin comprar nada,
--      de forma irreversible. Esto valía para las TRES clases de ítem que el
--      catálogo maneja (ver abajo), no sólo para las linkeadas a inventario.
--
-- ============================================================
-- QUÉ HACE ESTA MIGRACIÓN, POR CLASE DE ÍTEM
-- ============================================================
-- El catálogo maneja tres clases de ítem y NO se comportan igual. Esto importa
-- para saber qué queda cubierto y qué no:
--
--   A. Ítem linkeado a inventario (catalogo_items.inventario_id NOT NULL,
--      sin variantes). Es el único que la venta también toca.
--      → Pasa a RESERVAR (inventario.stock_reservado) en vez de descontar,
--        con réplica por depósito y asiento RESERVA/LIBERACION_RESERVA.
--        La devolución se netea contra el libro mayor de movimientos.
--
--   B. Variante (catalogo_variantes.stock).
--   C. Ítem sin link (catalogo_items.stock).
--      → SIGUEN DESCONTANDO DIRECTO. No tienen fila en inventario, así que no
--        pueden tener stock_reservado ni asiento (movimientos_inventario.
--        inventario_id es NOT NULL con FK), y crear_venta_atomica no las toca
--        nunca, así que NO corren riesgo de doble descuento. Lo que sí les
--        faltaba era la vuelta atrás: ahora cada descuento deja una fila en
--        catalogo_reservas_cotizacion (parte 0), y liberar_reserva_catalogo
--        RESTITUYE exactamente esa cantidad.
--      → Para B y C el número que ve el comprador ya era el correcto (baja al
--        pedir); no se les agrega columna de reservas a propósito: obligaría a
--        cambiar todas las lecturas de variantes del storefront sin arreglar
--        ningún bug real.
--      → Como la venta NO vuelve a descontarlas, el descuento del pedido ES el
--        de la venta: al convertir, consumir_reserva_catalogo cierra la reserva
--        sin devolver nada (parte 4b).
--
-- LO QUE QUEDA EXPLÍCITAMENTE FUERA DE ALCANCE:
--   * B y C no muestran sus reservas como "reservado" en ningún lado: su stock
--     simplemente baja. Es visibilidad, no corrección.
--   * Un ítem con inventario_id Y variantes activas descuenta la variante pero
--     igual guarda inventario_id en items_cotizacion (cotizar/route.ts). Esa
--     inconsistencia es anterior a esta migración y sigue acá.
--   * No hay backfill del stock que las solicitudes viejas ya se comieron: no
--     hay forma de distinguir las que terminaron en venta (descuento correcto)
--     de las abandonadas (espurio). Es ajuste manual, caso por caso.
--   * Una solicitud del catálogo RECHAZADA no se puede reabrir (guard en el PUT
--     de cotizaciones): al rechazarla se devolvió su stock, y reabrirla dejaría
--     una solicitud viva que no retiene nada. Lo correcto es una solicitud
--     nueva.
--   * El vencimiento automático. Ver la sección siguiente.
--
-- ============================================================
-- EL ARREGLO
-- ============================================================
-- Cambiar descuento por reserva SIN camino de liberación sería cosmético: el
-- stock quedaría igual de inmovilizado, sólo que en otra columna. Por eso van
-- juntas:
--
--   1. Clase A reserva en vez de descontar (parte 1), igual que el flujo
--      interno (reservar_items_cotizacion, migración 206).
--   2. Toda solicitud del catálogo se puede DEVOLVER, en las tres clases:
--      liberar_reserva_catalogo (partes 3 y 4). Cada clase se apoya en su
--      propio libro — movimientos_inventario para A, catalogo_reservas_cotizacion
--      para B y C — así que devuelve exactamente lo que se tomó, es idempotente
--      por construcción, y no se puede comer la reserva de otra cotización.
--   3. La devolución no depende de que nadie se acuerde: la dispara un TRIGGER
--      sobre cotizaciones (parte 7) cuando la fila entra en estado terminal.
--      Son cuatro las rutas que matan una cotización y una ya se había
--      olvidado de llamar.
--   4. El camino catálogo → orden → venta ya no reserva dos veces:
--      reservar_items_cotizacion (parte 6) reserva el FALTANTE por producto, y
--      devuelve el excedente si la cotización se redujo.
--
-- La conversión a venta libera la reserva (liberar_items_cotizacion) y
-- descuenta UNA sola vez por el camino de siempre.
--
-- Qué cambia para el usuario:
--   * inventario.stock deja de bajar cuando entra una solicitud del catálogo
--     de clase A. Lo que sube ahora es stock_reservado, visible como reserva
--     igual que las internas y liberable a mano. El stock "disponible" que ve
--     el comprador NO cambia: el storefront ya calcula stock - stock_reservado.
--   * Las reservas de clase A aparecen en el historial del producto como
--     movimiento RESERVA con referencia_tipo COTIZACION, y su devolución como
--     LIBERACION_RESERVA.
--
-- ============================================================
-- LO QUE ESTA MIGRACIÓN **NO** CIERRA: EL ABANDONO
-- ============================================================
-- Una solicitud del catálogo que NADIE responde retiene stock por tiempo
-- indefinido. No hay vencimiento: nada la barre, y `fecha_vencimiento` sigue
-- siendo un campo de display. La liberación existe pero es reactiva — alguien
-- tiene que rechazar o borrar la solicitud para que dispare.
--
-- Es decir: un visitante anónimo todavía puede llenar el carrito, no volver
-- nunca, y dejar ese stock retenido hasta que un humano limpie la cotización a
-- mano.
--
-- Esto sigue siendo estrictamente mejor que lo que hay hoy — hoy es un
-- descuento DURO que tampoco se libera nunca, y encima invisible: el stock
-- desaparece de inventario.stock sin dejar rastro, y no hay ninguna acción que
-- lo devuelva. Después de esta migración, al menos, el stock sigue estando (lo
-- retenido es visible como stock_reservado), rechazar o borrar lo devuelve, y
-- el movimiento RESERVA dice de qué cotización vino. Pero el agujero del
-- abandono no está cerrado, y no hay que leer esta migración como si lo
-- estuviera.
--
-- El vencimiento automático va en una rama aparte
-- (feat/catalogo-expiracion-reservas): tiene superficie de diseño propia
-- —barrera para no acreditar cotizaciones históricas, lotes para no morir por
-- timeout, y no soltarle la reserva a una orden en curso— y merece revisarse
-- por separado, no de arrastre.
--
-- REGRESIÓN CONOCIDA, a cambio de lo anterior:
--   Antes, el catálogo descontaba inventario.stock duro, así que una venta del
--   POS físicamente no podía llevarse esa unidad. Ahora sólo sube
--   stock_reservado, y crear_venta_atomica (269:119) valida contra el stock sin
--   mirar reservas. Última unidad: el comprador la pide por el catálogo, el POS
--   la vende igual, y al aprobar la cotización salta "Stock insuficiente" y la
--   aprobación revierte. Es exactamente cómo se comportan hoy las reservas
--   internas — consistente, pero es PÉRDIDA NETA de protección para el
--   comprador del catálogo. Hacer que el POS respete reservas es un cambio de
--   política que afecta a todo el sistema, no sólo al catálogo, y no se hace
--   acá.

-- ============================================================
-- Parte 1: reservar_stock_catalogo
-- ============================================================
-- Se agrega p_cotizacion_id para que el movimiento quede referenciado a la
-- solicitud. Cambia la aridad, así que hay que soltar la firma vieja: con las
-- dos vivas, una llamada de 2 argumentos sería ambigua.
--
-- p_cotizacion_id va SIN DEFAULT a propósito. Con `DEFAULT NULL`, una llamada
-- vieja de 2 argumentos seguiría resolviendo y asentaría el movimiento con
-- referencia_id NULL — una reserva que ningún camino de liberación puede
-- encontrar. Sin default, esa llamada falla fuerte y a la vista.

-- ============================================================
-- Parte 0: libro de reservas del catálogo para clases B y C
-- ============================================================
-- La clase A resuelve idempotencia y cantidad contra movimientos_inventario:
-- un libro que sabe CUÁNTO tomó CUÁL cotización. Las clases B y C no pueden
-- usar ese libro (movimientos_inventario.inventario_id es NOT NULL con FK a
-- inventario, y ellas no tienen fila ahí), así que necesitan el suyo.
--
-- Un booleano por cotización no alcanza: no puede responder "cuánto" ni "de
-- qué línea", así que la restitución tenía que adivinar sumando la cantidad
-- ACTUAL de items_cotizacion — que el admin puede editar, y que el PUT borra y
-- reinserta en cada guardado.
--
-- Va en tabla propia y no como columna de items_cotizacion justamente por eso:
-- el PUT de cotizaciones hace DELETE + INSERT de todas las líneas en cada
-- guardado, así que cualquier dato que viva en esa fila se pierde salvo que
-- alguien se acuerde de copiarlo. La reserva es un hecho del pasado ("esto se
-- tomó"), no un atributo de la línea actual.

CREATE TABLE IF NOT EXISTS catalogo_reservas_cotizacion (
  id                TEXT PRIMARY KEY DEFAULT generate_cuid(),
  cotizacion_id     TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Exactamente uno de los dos manda, según la rama que descontó.
  catalogo_item_id  TEXT,
  variante_id       TEXT,
  cantidad          INTEGER NOT NULL CHECK (cantidad > 0),
  liberada_at       TIMESTAMPTZ,
  motivo            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_reservas_destino_chk
    CHECK (variante_id IS NOT NULL OR catalogo_item_id IS NOT NULL)
);

-- Índice parcial: las consultas siempre preguntan por las reservas ABIERTAS de
-- una cotización, y las cerradas son la mayoría con el tiempo.
CREATE INDEX IF NOT EXISTS catalogo_reservas_abiertas_idx
  ON catalogo_reservas_cotizacion(cotizacion_id)
  WHERE liberada_at IS NULL;

COMMENT ON TABLE catalogo_reservas_cotizacion IS
  'Libro de reservas del catálogo público para stock que NO vive en inventario (variantes e items sin link). Una fila por descuento efectivo, cerrada con liberada_at al restituir o al consumirse en una venta. Es a las clases B y C lo que movimientos_inventario es a la clase A. v314.';

ALTER TABLE catalogo_reservas_cotizacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_reservas_select ON catalogo_reservas_cotizacion;
CREATE POLICY catalogo_reservas_select ON catalogo_reservas_cotizacion
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP FUNCTION IF EXISTS reservar_stock_catalogo(TEXT, JSONB);

CREATE OR REPLACE FUNCTION reservar_stock_catalogo(
  p_organization_id TEXT,
  p_items           JSONB,
  p_cotizacion_id   TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_item        JSONB;
  v_item_id     TEXT;
  v_variante_id TEXT;
  v_cantidad    INTEGER;
  v_stock       INTEGER;
  v_inv_id      TEXT;
  v_inv_stock   INTEGER;
  v_inv_reserv  INTEGER;
  v_disponible  INTEGER;
  v_deposito    TEXT;
  v_nombre      TEXT;
  v_var_stock   INTEGER;
  v_var_etq     TEXT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id     := v_item->>'item_id';
    v_variante_id := NULLIF(v_item->>'variante_id', '');
    v_cantidad    := (v_item->>'cantidad')::INTEGER;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_cantidad
        USING ERRCODE = '22023';
    END IF;

    -- ============ Variante ============
    -- catalogo_variantes no tiene fila en inventario ni detalle por depósito:
    -- su stock es un contador propio del catálogo y se sigue descontando acá.
    IF v_variante_id IS NOT NULL THEN
      SELECT stock, etiqueta INTO v_var_stock, v_var_etq
        FROM catalogo_variantes
        WHERE id = v_variante_id
          AND item_id = v_item_id
          AND organization_id = p_organization_id
          AND activo = TRUE
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variante % no encontrada o inactiva', v_variante_id
          USING ERRCODE = 'P0002';
      END IF;

      IF v_var_stock IS NOT NULL THEN
        IF v_var_stock < v_cantidad THEN
          RAISE EXCEPTION 'Stock insuficiente para variante "%" (disponible: %)', v_var_etq, v_var_stock
            USING ERRCODE = 'P0003';
        END IF;
        UPDATE catalogo_variantes
          SET stock = stock - v_cantidad
          WHERE id = v_variante_id;

        -- Se anota SÓLO cuando de verdad se descontó (stock NULL = el item no
        -- lleva control), para que la restitución nunca acredite de más.
        INSERT INTO catalogo_reservas_cotizacion (
          cotizacion_id, organization_id, catalogo_item_id, variante_id, cantidad
        ) VALUES (
          p_cotizacion_id, p_organization_id, v_item_id, v_variante_id, v_cantidad
        );
      END IF;
      CONTINUE;
    END IF;

    -- ============ Item base ============
    SELECT stock, inventario_id, nombre
      INTO v_stock, v_inv_id, v_nombre
      FROM catalogo_items
      WHERE id = v_item_id
        AND organization_id = p_organization_id
        AND activo = TRUE
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no encontrado o inactivo', v_item_id
        USING ERRCODE = 'P0002';
    END IF;

    -- Fuente de verdad única (239): inventario si está linkeado, si no
    -- catalogo_items.stock.
    IF v_inv_id IS NOT NULL THEN
      -- `deleted_at IS NULL` es obligatorio: liberar_items_cotizacion filtra
      -- igual y hace CONTINUE si no encuentra (206:1450). Si la reserva
      -- aceptara filas muertas, crearia una reserva que ningun camino puede
      -- liberar jamas.
      SELECT stock, stock_reservado INTO v_inv_stock, v_inv_reserv
        FROM inventario
        WHERE id = v_inv_id
          AND deleted_at IS NULL
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto vinculado a "%" ya no existe', v_nombre
          USING ERRCODE = 'P0002';
      END IF;

      -- Disponible = stock - reservado, el mismo criterio que
      -- reservar_items_cotizacion y que el storefront.
      IF v_inv_stock IS NOT NULL THEN
        v_disponible := v_inv_stock - COALESCE(v_inv_reserv, 0);

        IF v_disponible < v_cantidad THEN
          RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_disponible
            USING ERRCODE = 'P0003';
        END IF;

        UPDATE inventario
          SET stock_reservado = stock_reservado + v_cantidad
          WHERE id = v_inv_id;

        -- Réplica en el detalle por depósito (no strict: reparte entre filas
        -- con capacidad). Puede levantar P0011 si la org no tiene depósito
        -- principal; es el mismo riesgo que corre el flujo interno, y desde la
        -- migración 217 toda org nace con uno.
        v_deposito := reservar_stock_deposito(
          v_inv_id, p_organization_id, NULL, v_cantidad, false);

        -- usuario_id NULL a propósito: el flujo es público y anónimo, y la
        -- columna tiene FK a users(id) — cualquier string sintético revienta.
        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, organization_id,
          observaciones, deposito_id
        ) VALUES (
          v_inv_id, 'RESERVA', v_cantidad,
          v_inv_stock, v_inv_stock,
          p_cotizacion_id, 'COTIZACION', NULL, p_organization_id,
          'Reserva por solicitud desde el catálogo público',
          v_deposito
        );
      END IF;
    ELSIF v_stock IS NOT NULL THEN
      IF v_stock < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_stock
          USING ERRCODE = 'P0003';
      END IF;

      UPDATE catalogo_items
        SET stock = stock - v_cantidad
        WHERE id = v_item_id;

      INSERT INTO catalogo_reservas_cotizacion (
        cotizacion_id, organization_id, catalogo_item_id, variante_id, cantidad
      ) VALUES (
        p_cotizacion_id, p_organization_id, v_item_id, NULL, v_cantidad
      );
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) IS
  'Reserva stock para una solicitud del catálogo público. Fuente única por item: variante > inventario (si linkeado) > catalogo_items.stock. Sobre inventario RESERVA (stock_reservado) con réplica por depósito y asiento RESERVA en movimientos_inventario; nunca descuenta inventario.stock. v314.';

REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) TO service_role;

-- ============================================================
-- Parte 2: crear_cotizacion_publica_atomica
-- ============================================================
-- La reserva pasa a correr DESPUÉS del INSERT de la cotización para poder
-- referenciarla en movimientos_inventario. Sigue siendo una única transacción
-- plpgsql: si el stock no alcanza, rollbackea todo igual que antes (cotización,
-- items y consumo del cupón incluidos).
--
-- Único efecto observable del reordenamiento: cuando fallan cupón Y stock a la
-- vez, ahora gana el error del cupón (P0004 → 400) en lugar del de stock
-- (P0003 → 409). Antes era al revés. El route mapea ambos.

CREATE OR REPLACE FUNCTION crear_cotizacion_publica_atomica(
  p_cotizacion  JSONB,   -- { organization_id, cliente_id, numero_cotizacion, public_token, notas, subtotal, iva, cupon_codigo? }
  p_items       JSONB,   -- [{ descripcion, cantidad, precio_unitario, subtotal, inventario_id, catalogo_item_id, comentario_cliente, adjuntos, variante_id, variante_etiqueta }]
  p_stock_items JSONB,   -- [{ item_id, cantidad, variante_id? }] para reservar_stock_catalogo
  p_telefono    TEXT     -- para marcar abandono recovered (opcional, NULL = no marcar)
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cotizacion_id TEXT;
  v_item          JSONB;
  v_org_id        TEXT;
  v_stock_ok      BOOLEAN;
  v_subtotal      DECIMAL;
  v_iva           DECIMAL;
  v_codigo        TEXT;
  v_cupon_res     JSONB;
  v_cupon_id      TEXT := NULL;
  v_cupon_codigo  TEXT := NULL;
  v_descuento     DECIMAL := 0;
  v_total         DECIMAL;
BEGIN
  v_org_id   := p_cotizacion->>'organization_id';
  v_subtotal := COALESCE((p_cotizacion->>'subtotal')::DECIMAL, 0);
  v_iva      := COALESCE((p_cotizacion->>'iva')::DECIMAL, 0);
  v_codigo   := NULLIF(p_cotizacion->>'cupon_codigo', '');

  -- 1. Cupón dentro de la transacción (fix ERR-02, migración 240).
  -- aplicar_cupon_catalogo valida + incrementa usos_actuales con FOR UPDATE.
  -- Si algo falla más abajo, el incremento rollbackea solo: nunca queda un
  -- cupón consumido sin cotización.
  IF v_codigo IS NOT NULL THEN
    v_cupon_res := aplicar_cupon_catalogo(v_org_id, v_codigo, v_subtotal);
    IF NOT COALESCE((v_cupon_res->>'ok')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION '%', COALESCE(v_cupon_res->>'error', 'Cupón inválido')
        USING ERRCODE = 'P0004';
    END IF;
    v_cupon_id     := v_cupon_res->>'cupon_id';
    v_cupon_codigo := v_cupon_res->>'codigo';
    v_descuento    := COALESCE((v_cupon_res->>'descuento_aplicado')::DECIMAL, 0);
  END IF;

  v_total := GREATEST(0, v_subtotal - v_descuento) + v_iva;

  -- 2. Cotización + items.
  INSERT INTO cotizaciones (
    organization_id, cliente_id, numero_cotizacion, public_token,
    tipo, estado, origen, notas,
    subtotal, iva, total, iva_porcentaje,
    descuento_global_tipo, descuento_global_valor,
    cupon_id, cupon_codigo, cupon_descuento
  )
  VALUES (
    v_org_id,
    p_cotizacion->>'cliente_id',
    p_cotizacion->>'numero_cotizacion',
    p_cotizacion->>'public_token',
    'PRESUPUESTO',
    'ENVIADA',
    'CATALOGO_PUBLICO',
    p_cotizacion->>'notas',
    v_subtotal,
    v_iva,
    v_total,
    0,
    'porcentaje',
    0,
    v_cupon_id,
    v_cupon_codigo,
    CASE WHEN v_descuento > 0 THEN v_descuento ELSE NULL END
  )
  RETURNING id INTO v_cotizacion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_cotizacion (
      cotizacion_id, descripcion, cantidad, precio_unitario, subtotal,
      unidad, descuento_tipo, descuento_valor,
      inventario_id, catalogo_item_id, tipo_repuesto,
      comentario_cliente, adjuntos,
      variante_id, variante_etiqueta
    )
    VALUES (
      v_cotizacion_id,
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precio_unitario')::DECIMAL,
      (v_item->>'subtotal')::DECIMAL,
      'Unidad',
      'porcentaje',
      0,
      NULLIF(v_item->>'inventario_id', ''),
      NULLIF(v_item->>'catalogo_item_id', ''),
      'NO_APLICA',
      NULLIF(v_item->>'comentario_cliente', ''),
      COALESCE(v_item->'adjuntos', '[]'::jsonb),
      NULLIF(v_item->>'variante_id', ''),
      NULLIF(v_item->>'variante_etiqueta', '')
    );
  END LOOP;

  -- 3. Reservar stock con la cotización ya creada, para que el movimiento
  -- quede referenciado a ella. Si no alcanza (P0003), la exception revierte
  -- cotización, items y cupón.
  v_stock_ok := reservar_stock_catalogo(v_org_id, p_stock_items, v_cotizacion_id);

  IF p_telefono IS NOT NULL AND length(p_telefono) > 0 THEN
    UPDATE catalogo_carritos_abandonados
    SET recovered_at = NOW(),
        cotizacion_id = v_cotizacion_id
    WHERE organization_id = v_org_id
      AND cliente_telefono = p_telefono
      AND recovered_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cotizacion_id', v_cotizacion_id,
    'cupon_id', v_cupon_id,
    'cupon_codigo', v_cupon_codigo,
    'cupon_descuento', v_descuento,
    'total', v_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) TO service_role;

-- ============================================================
-- Parte 3: reserva_cotizacion_pendiente
-- ============================================================
-- Cuánto tiene reservado HOY una cotización, según el libro mayor de
-- movimientos referenciados a ella.
--
-- Hace falta porque liberar_items_cotizacion libera
-- LEAST(item.cantidad, inventario.stock_reservado) mirando la fila de
-- inventario: sobre una cotización que nunca reservó, se comería la reserva de
-- OTRA cotización. Los movimientos referenciados son lo único que dice cuánto
-- tomó ESTA cotización, y hacen la liberación idempotente: después de liberar,
-- el asiento LIBERACION_RESERVA baja el neto a 0 y una segunda llamada no
-- devuelve nada.

CREATE OR REPLACE FUNCTION reserva_cotizacion_pendiente(p_cotizacion_id TEXT)
RETURNS TABLE (inventario_id TEXT, cantidad INTEGER) AS $$
  SELECT
    mi.inventario_id,
    SUM(CASE WHEN mi.tipo = 'RESERVA' THEN mi.cantidad ELSE -mi.cantidad END)::INTEGER
  FROM movimientos_inventario mi
  WHERE mi.referencia_id   = p_cotizacion_id
    AND mi.referencia_tipo = 'COTIZACION'
    AND mi.tipo IN ('RESERVA', 'LIBERACION_RESERVA')
  GROUP BY mi.inventario_id
  HAVING SUM(CASE WHEN mi.tipo = 'RESERVA' THEN mi.cantidad ELSE -mi.cantidad END) > 0;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION reserva_cotizacion_pendiente(TEXT) IS
  'Reserva viva de una cotización por item, neteando RESERVA contra LIBERACION_RESERVA en movimientos_inventario. v314.';

REVOKE EXECUTE ON FUNCTION reserva_cotizacion_pendiente(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reserva_cotizacion_pendiente(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION reserva_cotizacion_pendiente(TEXT) TO service_role;

-- ============================================================
-- Parte 4: liberar_reserva_catalogo
-- ============================================================
-- Devuelve la reserva que tomó una solicitud del catálogo. Se llama al
-- rechazar (desde CUALQUIER estado), al borrar en soft y al vencer.
--
-- No filtra `deleted_at` sobre inventario a propósito: si el producto se
-- borró en soft después de la reserva, esa reserva igual tiene que volver.

CREATE OR REPLACE FUNCTION liberar_reserva_catalogo(
  p_cotizacion_id TEXT,
  p_motivo        TEXT DEFAULT 'Reserva del catálogo liberada'
) RETURNS JSONB AS $$
DECLARE
  v_org_id     TEXT;
  v_origen     TEXT;
  v_row        RECORD;
  v_linea      RECORD;
  v_stock      INTEGER;
  v_reservado  INTEGER;
  v_delta      INTEGER;
  v_deposito   TEXT;
  v_count      INTEGER := 0;
  v_catalogo   INTEGER := 0;
BEGIN
  -- FOR UPDATE sobre la cotización serializa las liberaciones concurrentes.
  -- Sin esto, el cron de expiración y un rechazo del admin pegando a la vez
  -- leen el mismo pendiente, serializan recién en el lock de inventario y cada
  -- uno descuenta: stock_reservado se clampea (comiéndose reserva ajena) y el
  -- libro de esta cotización se va a negativo.
  SELECT organization_id, origen
    INTO v_org_id, v_origen
    FROM cotizaciones
    WHERE id = p_cotizacion_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'itemsLiberados', 0);
  END IF;

  -- Sólo cotizaciones nacidas del catálogo. Las internas ya tienen su propio
  -- ciclo de reserva/liberación y no hay que tocarlo.
  IF v_origen IS DISTINCT FROM 'CATALOGO_PUBLICO' THEN
    RETURN jsonb_build_object('ok', true, 'itemsLiberados', 0);
  END IF;

  -- ── Items linkeados a inventario: reserva, se netea contra el libro ──
  FOR v_row IN SELECT * FROM reserva_cotizacion_pendiente(p_cotizacion_id)
  LOOP
    SELECT stock, stock_reservado INTO v_stock, v_reservado
      FROM inventario
      WHERE id = v_row.inventario_id
      FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Se libera (y se asienta) lo que REALMENTE se puede devolver. Registrar
    -- la cantidad entera cuando la columna sólo alcanzó para menos dejaba el
    -- libro en 0 y la diferencia perdida en silencio.
    v_delta := LEAST(v_row.cantidad, GREATEST(0, COALESCE(v_reservado, 0)));

    IF v_delta <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE inventario
      SET stock_reservado = stock_reservado - v_delta
      WHERE id = v_row.inventario_id;

    v_deposito := liberar_reserva_deposito(
      v_row.inventario_id, v_org_id, NULL, v_delta);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_row.inventario_id, 'LIBERACION_RESERVA', v_delta,
      v_stock, v_stock,
      p_cotizacion_id, 'COTIZACION', NULL, v_org_id,
      p_motivo, v_deposito
    );

    v_count := v_count + 1;
  END LOOP;

  -- ── Variantes e items sin link: descuento directo, se restituye ──
  -- Se devuelve exactamente lo que dice el libro de reservas del catálogo, que
  -- es lo que se tomó. Ni la cantidad actual de la línea (el admin la edita, y
  -- el PUT reinserta las filas en cada guardado) ni un booleano por cotización
  -- pueden responder eso.
  --
  -- El destino también sale del libro, no de la fila de hoy: la reserva guardó
  -- por qué rama se descontó, así que vincular o desvincular el ítem después
  -- del pedido no cambia por dónde vuelve.
  --
  -- Cada fila se cierra por separado: la idempotencia es por construcción, no
  -- por una marca aparte.
  FOR v_linea IN
    SELECT r.id, r.catalogo_item_id, r.variante_id, r.cantidad
    FROM catalogo_reservas_cotizacion r
    WHERE r.cotizacion_id = p_cotizacion_id
      AND r.liberada_at IS NULL
    FOR UPDATE
  LOOP
    IF v_linea.variante_id IS NOT NULL THEN
      UPDATE catalogo_variantes
        SET stock = stock + v_linea.cantidad
        WHERE id = v_linea.variante_id
          AND stock IS NOT NULL;
    ELSE
      UPDATE catalogo_items
        SET stock = stock + v_linea.cantidad
        WHERE id = v_linea.catalogo_item_id
          AND stock IS NOT NULL;
    END IF;

    -- La reserva se cierra aunque el destino ya no exista: si el ítem o la
    -- variante se borró, no hay dónde devolver y dejarla abierta sólo haría que
    -- cada liberación futura la reintente para siempre.
    UPDATE catalogo_reservas_cotizacion
      SET liberada_at = NOW(),
          motivo      = p_motivo
      WHERE id = v_linea.id;

    v_catalogo := v_catalogo + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'itemsLiberados', v_count,
    'itemsCatalogoRestaurados', v_catalogo
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) IS
  'Devuelve la reserva viva de una cotización del catálogo público. Idempotente (se apoya en reserva_cotizacion_pendiente). No-op sobre cotizaciones de otro origen. v314.';

REVOKE EXECUTE ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) TO service_role;

-- ============================================================
-- Parte 4b: consumir_reserva_catalogo
-- ============================================================
-- En las clases B y C el descuento del pedido ES el descuento de la venta:
-- crear_venta_atomica no toca catalogo_variantes ni catalogo_items, así que la
-- mercadería sale del estante con el descuento que hizo la solicitud.
--
-- Por eso la venta tiene que CERRAR la reserva sin devolver nada. Si no, la
-- reserva queda abierta y cualquier rechazo posterior — y el estado se puede
-- editar después de la venta: el guard sólo bloquea tocar los ítems — acredita
-- de vuelta mercadería que ya salió por la puerta.
--
-- La clase A no necesita esto: la venta descuenta inventario.stock y libera su
-- reserva por liberar_items_cotizacion, y el libro mayor queda neteado solo.

CREATE OR REPLACE FUNCTION consumir_reserva_catalogo(
  p_cotizacion_id TEXT,
  p_motivo        TEXT DEFAULT 'Reserva consumida por la venta'
) RETURNS JSONB AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE catalogo_reservas_cotizacion
    SET liberada_at = NOW(),
        motivo      = p_motivo
    WHERE cotizacion_id = p_cotizacion_id
      AND liberada_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'itemsConsumidos', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consumir_reserva_catalogo(TEXT, TEXT) IS
  'Cierra las reservas de catálogo (clases B y C) de una cotización SIN devolver stock: la venta se quedó la mercadería. v314.';

REVOKE EXECUTE ON FUNCTION consumir_reserva_catalogo(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION consumir_reserva_catalogo(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION consumir_reserva_catalogo(TEXT, TEXT) TO service_role;

-- ============================================================
-- Parte 4c: convertir_cotizacion_venta_atomica
-- ============================================================
-- Redefinición de la migración 246 con un paso más: consumir la reserva del
-- catálogo. Va DENTRO de la misma transacción que la venta, así que si algo
-- falla no queda ni venta ni reserva consumida.
-- La lista de parámetros es idéntica a la 246 para no romper el caller.

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
  v_result JSONB;
BEGIN
  v_result := crear_venta_atomica(
    p_org_id, p_vendedor_id, p_cliente_id, p_cliente_nombre, p_cliente_telefono,
    p_subtotal, p_descuento, p_tipo_descuento, p_porcentaje_descuento, p_total,
    p_metodo_pago, p_observaciones, p_numero_referencia, p_cuotas,
    p_recargo_porcentaje, p_monto_original, p_items, p_pagos,
    p_idempotency_key, p_deposito_id, p_sucursal_id
  );

  IF p_cotizacion_id IS NOT NULL THEN
    -- Clase A: devolver la reserva de inventario, que la venta ya descontó.
    PERFORM liberar_items_cotizacion(
      p_cotizacion_id, p_vendedor_id, 'Reserva consumida por conversión a venta');

    -- Clases B y C: cerrar la reserva SIN devolver — la venta se quedó el stock.
    PERFORM consumir_reserva_catalogo(
      p_cotizacion_id, 'Reserva consumida por conversión a venta');
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION convertir_cotizacion_venta_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,DECIMAL,DECIMAL,TEXT,DECIMAL,DECIMAL,TEXT,TEXT,TEXT,INTEGER,DECIMAL,DECIMAL,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) IS
  'crear_venta_atomica + liberar_items_cotizacion + consumir_reserva_catalogo en una transacción. v314 (extiende la 246).';

-- ============================================================
-- Parte 5: reservar_items_cotizacion idempotente por cotización
-- ============================================================
-- Cierra el doble-reserva del camino catálogo → venta:
--   catálogo reserva 1x  →  convertir-orden pone tipo='ORDEN' (deja ENVIADA)
--   →  aprobar reserva OTRA VEZ, porque aprobar_cotizacion_atomica reserva
--      siempre que tipo <> 'PRESUPUESTO'  →  2x reservado
--   →  la venta descuenta 1x y libera 1x  →  queda 1x reservado PARA SIEMPRE.
--
-- Se elige saltear la reserva de aprobación (en vez de liberar la del catálogo
-- en convertir-orden) para que la unidad quede retenida de punta a punta: la
-- otra opción abre una ventana entre convertir-orden y aprobar donde otro
-- comprador puede llevarse el stock y la aprobación falla.
--
-- El guard es por (cotización, item) contra el libro mayor y no por
-- `origen = 'CATALOGO_PUBLICO'`: así protege también al fallback JS de la ruta
-- de aprobar y a la aprobación desde el portal público, sin cambiar en nada el
-- comportamiento de una cotización que todavía no reservó (libro vacío).
--
-- Copia de la definición de la migración 206 + el guard.

CREATE OR REPLACE FUNCTION reservar_items_cotizacion(
  p_cotizacion_id TEXT,
  p_user_id       TEXT,
  p_deposito_id   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_item              RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_disponible        INTEGER;
  v_count             INTEGER := 0;
  v_deposito_efectivo TEXT;
  v_ya_reservado      INTEGER;
  v_faltante          INTEGER;
  v_exceso            INTEGER;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM cotizaciones WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;

  -- Se agrupa por producto porque reserva_cotizacion_pendiente también agrupa
  -- por inventario_id: comparar ese agregado contra la cantidad de UNA línea
  -- sub-reserva las cotizaciones con el mismo producto repetido (dos líneas de
  -- 3 reservaban 3 en vez de 6), y el formulario de cotización agrega líneas
  -- sin deduplicar por inventario. Los dos lados tienen que estar agregados.
  FOR v_item IN
    SELECT
      ic.inventario_id,
      SUM(ic.cantidad)::INTEGER AS cantidad,
      MIN(ic.descripcion)       AS descripcion
    FROM items_cotizacion ic
    WHERE ic.cotizacion_id = p_cotizacion_id
      AND ic.inventario_id IS NOT NULL
    GROUP BY ic.inventario_id
  LOOP
    -- Cuánto de lo que pide esta cotización ya está reservado por ella misma.
    SELECT cantidad INTO v_ya_reservado
      FROM reserva_cotizacion_pendiente(p_cotizacion_id)
      WHERE inventario_id = v_item.inventario_id;

    -- Se reserva el FALTANTE, no la cantidad entera encima de lo que había:
    -- con cobertura parcial (la solicitud reservó 2 y después un admin editó
    -- la línea a 5) reservar 5 dejaba 7 tomadas para una cotización de 5, y la
    -- venta liberaba 5 dejando 2 colgadas para siempre.
    v_faltante := v_item.cantidad - COALESCE(v_ya_reservado, 0);

    -- Sobre-cobertura: la cotización tiene tomado MÁS de lo que pide ahora
    -- (el catálogo reservó 5 y el admin la editó a 2). Saltear dejaba ese
    -- excedente colgado para siempre: la venta libera LEAST(cantidad_actual, …)
    -- y liberar_reserva_catalogo sólo corre en rechazo o borrado, que el DELETE
    -- ni siquiera permite sobre una cotización ACEPTADA. Hay que devolverlo acá.
    IF v_faltante < 0 THEN
      SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
      FROM inventario
      WHERE id = v_item.inventario_id AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_exceso := LEAST(-v_faltante, GREATEST(0, COALESCE(v_stock_reservado, 0)));

      IF v_exceso > 0 THEN
        UPDATE inventario
        SET stock_reservado = stock_reservado - v_exceso
        WHERE id = v_item.inventario_id;

        v_deposito_efectivo := liberar_reserva_deposito(
          v_item.inventario_id, v_org_id, p_deposito_id, v_exceso);

        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, organization_id,
          observaciones, deposito_id
        ) VALUES (
          v_item.inventario_id, 'LIBERACION_RESERVA', v_exceso,
          v_stock, v_stock,
          p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
          'Ajuste: la cotización redujo la cantidad reservada',
          v_deposito_efectivo
        );
      END IF;

      CONTINUE;
    END IF;

    IF v_faltante = 0 THEN
      CONTINUE;
    END IF;

    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_item.inventario_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado para item "%"', v_item.descripcion;
    END IF;

    v_disponible := v_stock - v_stock_reservado;

    IF v_disponible < v_faltante THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, Solicitado: %',
        v_item.descripcion, v_disponible, v_faltante;
    END IF;

    UPDATE inventario
    SET stock_reservado = stock_reservado + v_faltante
    WHERE id = v_item.inventario_id;

    v_deposito_efectivo := reservar_stock_deposito(
      v_item.inventario_id, v_org_id, p_deposito_id, v_faltante, false);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_item.inventario_id, 'RESERVA', v_faltante,
      v_stock, v_stock,
      p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
      'Reserva por aprobación de cotización',
      v_deposito_efectivo
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsReservados', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reservar_items_cotizacion(TEXT, TEXT, TEXT) IS
  'Reserva stock de los items de una cotización. Idempotente por (cotización, item) contra movimientos_inventario: no re-reserva lo que esa cotización ya tiene tomado, y devuelve el excedente si la cotización se redujo. v314.';

-- ============================================================
-- Parte 7: trigger de liberación
-- ============================================================
-- Hay CUATRO rutas que matan una cotización, y la liberación se enganchaba a
-- mano en cada una:
--   1. PUT  /api/cotizaciones/[id]                      (estado RECHAZADA)
--   2. DELETE /api/cotizaciones/[id]                    (deleted_at)
--   3. POST /api/public/cotizaciones/[token]/rechazar   (portal de cotización)
--   4. POST /api/public/ordenes/[token]/reject-budget   (portal de orden)
--
-- La 4 se nos pasó — y es la más fácil de pasar por alto, porque no toca una
-- cotización puntual sino que hace un UPDATE masivo por orden_id. Con cuatro
-- superficies y una ya olvidada, engancharlo a mano es cuestión de tiempo.
--
-- El trigger lo pone en el único lugar del que ninguna ruta se puede olvidar:
-- la tabla. Cubre también el SQL a mano y cualquier ruta futura.
--
-- El WHEN evita la recursión: liberar_reserva_catalogo no escribe estado ni
-- deleted_at en cotizaciones (cierra filas en catalogo_reservas_cotizacion),
-- así que su propio trabajo nunca vuelve a disparar el trigger.
--
-- Los errores NO se tragan: si la liberación falla, falla el rechazo. Es
-- deliberado — la alternativa es una fuga de stock silenciosa y sin camino de
-- recuperación, porque en esta rama no hay barrido de rescate. Mismo criterio
-- que aprobar_cotizacion_atomica con reservar_items_cotizacion (migración 246).

CREATE OR REPLACE FUNCTION trg_liberar_reserva_catalogo()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM liberar_reserva_catalogo(
    NEW.id,
    CASE
      WHEN NEW.deleted_at IS NOT NULL THEN 'Solicitud del catálogo eliminada'
      ELSE 'Solicitud del catálogo rechazada'
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cotizaciones_liberar_reserva_catalogo ON cotizaciones;

CREATE TRIGGER cotizaciones_liberar_reserva_catalogo
  AFTER UPDATE ON cotizaciones
  FOR EACH ROW
  WHEN (
    (NEW.estado::TEXT = 'RECHAZADA' AND OLD.estado::TEXT IS DISTINCT FROM 'RECHAZADA')
    OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  )
  EXECUTE FUNCTION trg_liberar_reserva_catalogo();

COMMENT ON FUNCTION trg_liberar_reserva_catalogo() IS
  'Libera la reserva del catálogo cuando una cotización entra en estado terminal. Existe para que ninguna de las cuatro superficies de rechazo/borrado tenga que acordarse de llamar. v314.';
