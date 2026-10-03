-- Migration 327: una cotizacion se convierte en venta una sola vez.
--
-- Antes: convertir_cotizacion_venta_atomica no bloqueaba ni marcaba la
-- cotizacion. Seguia ACEPTADA con el boton "Convertir a venta" visible, y cada
-- click (o una segunda pestaña, o un reintento) creaba otra venta: descontaba
-- stock de nuevo, volvia a cargar la cuenta corriente y duplicaba comision.
-- cotizaciones.venta_id existe desde la 082 pero nadie la escribia.
--
-- Ahora, en la misma transaccion de la venta:
--   1. FOR UPDATE sobre la cotizacion: dos conversiones simultaneas se serializan.
--   2. Si venta_id apunta a una venta que no esta ANULADA → P0020.
--      (Despues de anular la venta se puede volver a convertir.)
--   3. Se graba venta_id con la venta nueva.
--
-- La ruta ademas manda una clave de idempotencia por cotizacion, asi que el
-- doble click ya queda frenado aun sin esta migracion (indice unico de la 200).
-- Misma firma que la 315: es seguro aplicar antes o despues del deploy.

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
BEGIN
  IF p_cotizacion_id IS NOT NULL THEN
    SELECT venta_id INTO v_venta_previa
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
    -- Clase A: devolver la reserva de inventario, que la venta ya descontó.
    PERFORM liberar_items_cotizacion(
      p_cotizacion_id, p_vendedor_id, 'Reserva consumida por conversión a venta');

    -- Clases B y C: cerrar la reserva SIN devolver — la venta se quedó el stock.
    PERFORM consumir_reserva_catalogo(
      p_cotizacion_id, 'Reserva consumida por conversión a venta');

    UPDATE cotizaciones
    SET venta_id = v_result->>'ventaId'
    WHERE id = p_cotizacion_id AND organization_id = p_org_id;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Backfill: las cotizaciones convertidas antes de esta migracion no tienen
-- venta_id. La ruta escribe "Convertida desde <numero>" en las observaciones de
-- la venta; con eso se recupera el vinculo para que no se puedan volver a
-- convertir. Solo ventas vigentes.
UPDATE cotizaciones c
SET venta_id = (
  SELECT v.id
  FROM ventas v
  WHERE v.organization_id = c.organization_id
    AND v.estado = 'COMPLETADA'
    AND (
      v.observaciones = 'Convertida desde ' || c.numero_cotizacion
      OR v.observaciones LIKE 'Convertida desde ' || c.numero_cotizacion || '.%'
    )
  ORDER BY v.created_at DESC
  LIMIT 1
)
WHERE c.venta_id IS NULL
  AND c.estado = 'ACEPTADA'
  AND EXISTS (
    SELECT 1
    FROM ventas v
    WHERE v.organization_id = c.organization_id
      AND v.estado = 'COMPLETADA'
      AND (
        v.observaciones = 'Convertida desde ' || c.numero_cotizacion
        OR v.observaciones LIKE 'Convertida desde ' || c.numero_cotizacion || '.%'
      )
  );
