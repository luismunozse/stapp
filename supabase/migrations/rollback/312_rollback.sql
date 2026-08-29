-- Rollback de la migracion 312.
--
-- Restaura aprobar_cotizacion_atomica a la version de la migracion 246, sin
-- la liberacion de reservas de la cotizacion reemplazada. Ninguna otra
-- migracion toco esta funcion entre la 246 y la 312, asi que este es el
-- cuerpo exacto previo.
--
-- Un DROP FUNCTION en vez de esto dejaria sin aprobar_cotizacion_atomica: la
-- ruta POST /api/cotizaciones/[id]/aprobar cae a un fallback en JS solo
-- cuando el error es "funcion no encontrada", pero ese fallback tampoco
-- libera nada -- y de todos modos preferimos volver a la funcion probada
-- en vez de forzar ese camino.
--
-- Despues de este rollback, aprobar una revision vuelve a dejar la reserva
-- de la cotizacion original viva -- el bug fantasma que la migracion 312
-- cierra. Revertir tambien el codigo de la app si se revierte esto.

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

  -- Reserve stock for non-PRESUPUESTO cotizaciones
  -- FATAL: if reservar_items_cotizacion raises (stock insuficiente) the whole
  -- approval transaction rolls back — cotizacion stays ENVIADA.
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
  'Atomically approves a cotizacion (ENVIADA → ACEPTADA) and reserves inventory. '
  'Uses FOR UPDATE to prevent concurrent double-approve. '
  'Stock reservation failure rolls back the entire approval. Migration 246.';
