-- Migration 312: al aprobar una revision, liberar las reservas de la
-- cotizacion que reemplaza.
--
-- Una cotizacion aceptada reserva stock contra SUS items (migracion 246).
-- Una revision (migracion 311, columna revision_de) nace como copia de esos
-- items para corregir la original -- pero la original sigue firmada, con su
-- reserva viva. Si la revision se aprueba y reserva los suyos sin liberar
-- primero los de la original, una pieza presente en las dos versiones queda
-- contada dos veces: el mismo bug fantasma de stock_reservado inflado para
-- siempre que la migracion 246 existe para prevenir.
--
-- La liberacion va DENTRO de la misma transaccion que reserva_items_cotizacion,
-- y ANTES de ella -- nunca despues. Al reves, esa pieza compartida quedaria
-- contada dos veces aunque sea por un instante, y cualquier fallo en esa
-- ventana deja la reserva vieja sin liberar para siempre. Mismo patron que
-- convertir_cotizacion_venta_atomica (migracion 246, Parte 2): envolver
-- liberar + [la operacion que sigue] en una sola funcion para que un fallo
-- revierta todo en vez de dejar una reserva huerfana.
--
-- La firma de aprobar_cotizacion_atomica queda byte-identica: los llamadores
-- pasan argumentos posicionales y cambiarla dejaria resoluble el overload
-- viejo, produciendo dos funciones donde se espera una.

CREATE OR REPLACE FUNCTION aprobar_cotizacion_atomica(
  p_org_id       TEXT,
  p_cotizacion_id TEXT,
  p_user_id      TEXT,
  p_firma        TEXT    DEFAULT NULL,
  p_firma_mime   TEXT    DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_cot cotizaciones%ROWTYPE;
BEGIN
  -- Lock the row and verify it exists and belongs to the org
  SELECT * INTO v_cot
  FROM cotizaciones
  WHERE id = p_cotizacion_id
    AND organization_id = p_org_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotizacion no encontrada';
  END IF;

  -- Optimistic state guard (prevents double-approve)
  IF v_cot.estado::TEXT <> 'ENVIADA' THEN
    RAISE EXCEPTION 'Solo se pueden aprobar cotizaciones enviadas';
  END IF;

  -- Atomically update estado + firma fields
  UPDATE cotizaciones
  SET estado           = 'ACEPTADA',
      firma_aprobacion = p_firma,
      firma_mime       = p_firma_mime,
      fecha_aprobacion = NOW()
  WHERE id = p_cotizacion_id;

  -- Si esto es una revision, la cotizacion que reemplaza tiene stock reservado
  -- contra SUS items. Se libera antes de reservar los nuevos: al reves, una
  -- pieza presente en las dos versiones quedaria contada dos veces aunque sea
  -- por un instante, y cualquier error posterior la dejaria inflada.
  -- Mismo patron que convertir_cotizacion_venta_atomica (migracion 246).
  --
  -- El chequeo de tipo espeja al del bloque de reserva de abajo: un
  -- PRESUPUESTO nunca reserva stock al aprobarse (ver el IF de mas abajo), asi
  -- que la cotizacion que reemplaza -- si tambien era PRESUPUESTO -- nunca
  -- tuvo nada reservado. Liberar igual no es un no-op inofensivo: como
  -- stock_reservado es un contador global por item, liberar_items_cotizacion
  -- restaria de otras reservas legitimas de ese mismo item (subreserva, la
  -- imagen espejo del bug fantasma que esta migracion previene).
  IF v_cot.revision_de IS NOT NULL AND v_cot.tipo::TEXT <> 'PRESUPUESTO' THEN
    PERFORM liberar_items_cotizacion(
      v_cot.revision_de,
      COALESCE(p_user_id, 'system'),
      'Reserva liberada: reemplazada por revision ' || p_cotizacion_id
    );
  END IF;

  -- Reserve stock for non-PRESUPUESTO cotizaciones
  -- FATAL: if reservar_items_cotizacion raises (stock insuficiente) the whole
  -- approval transaction rolls back — cotizacion stays ENVIADA, and the
  -- liberar above rolls back with it (no orphaned release either).
  IF v_cot.tipo::TEXT <> 'PRESUPUESTO' THEN
    PERFORM reservar_items_cotizacion(
      p_cotizacion_id,
      COALESCE(p_user_id, 'system')
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aprobar_cotizacion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Atomically approves a cotizacion (ENVIADA → ACEPTADA), reserves inventory, '
  'and — when the row is a non-PRESUPUESTO revision (revision_de IS NOT NULL) — '
  'releases the superseded cotizacion''s reservations first, in the same '
  'transaction. A PRESUPUESTO never reserves, so its revision never releases. '
  'Uses FOR UPDATE to prevent concurrent double-approve. '
  'Stock reservation failure rolls back the entire approval. Migrations 246, 312.';
