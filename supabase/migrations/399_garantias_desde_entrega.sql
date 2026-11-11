-- Garantías de reparación: corren desde la entrega y el link de seguimiento
-- dura al menos lo mismo que la garantía (Fase 0, docs/garantias-flujo-2026-11-11.md).
--
-- 1. Condiciones de garantía del presupuesto en la orden.
--    Al convertir un presupuesto en orden se creaba la garantía con la orden en
--    RECIBIDO: el plazo corría desde el ingreso y, como garantias.orden_id es
--    UNIQUE, la garantía de la entrega fallaba en silencio. Ahora la conversión
--    solo guarda días y alcance en la orden, y la entrega los aplica.
--    Las dos columnas son NULL en las órdenes que no vienen de un presupuesto.
--
-- 2. Vencimiento del token público al entregar.
--    Desde la 080 registrar_cambio_estado_tiempo() asignaba
--    NEW.public_token_expires_at, pero el trigger es AFTER UPDATE OF estado: en
--    un trigger AFTER esa asignación no tiene efecto, así que el vencimiento de
--    30 días dejó de escribirse. Se vuelve al UPDATE de la 068/100 y se toma el
--    máximo entre entrega + 30 días y el fin de la garantía de la orden.
--    Las órdenes ya entregadas con el token sin vencimiento no se tocan.
--
-- 3. Al crear o extender una garantía, el token se estira hasta el día
--    siguiente al vencimiento (fecha_vencimiento se guarda al mediodía UTC del
--    último día; el día siguiente cubre ese día completo en cualquier zona).
--    Solo extiende, nunca acorta, y no toca tokens sin vencimiento.
--
-- 4. Backfill: los tokens ya vencidos o por vencer de órdenes con garantía se
--    estiran hasta el fin de esa garantía.

SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Condiciones de garantía del presupuesto
-- ----------------------------------------------------------------------------
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS garantia_presupuesto_dias INTEGER,
  ADD COLUMN IF NOT EXISTS garantia_presupuesto_alcance TEXT;

-- NOT VALID: las columnas recién creadas son NULL en todas las filas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_servicio_garantia_presupuesto_dias_check') THEN
    ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_garantia_presupuesto_dias_check
      CHECK (garantia_presupuesto_dias >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_servicio_garantia_presupuesto_alcance_check') THEN
    ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_garantia_presupuesto_alcance_check
      CHECK (garantia_presupuesto_alcance IN ('REPUESTO', 'MANO_OBRA', 'AMBOS', 'NINGUNA')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN ordenes_servicio.garantia_presupuesto_dias IS
  'Días de garantía del presupuesto del que nació la orden. La entrega los usa en vez del valor por defecto de la org.';
COMMENT ON COLUMN ordenes_servicio.garantia_presupuesto_alcance IS
  'Alcance de la garantía del presupuesto (REPUESTO, MANO_OBRA, AMBOS, NINGUNA). La entrega lo agrega a las notas.';

-- ----------------------------------------------------------------------------
-- 2. Vencimiento del token al entregar (misma función que la 142, cambia solo
--    el bloque del token)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    UPDATE orden_tiempos_estado
    SET fin = NOW()
    WHERE orden_id = NEW.id AND estado = OLD.estado::text AND fin IS NULL;

    INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
    VALUES (NEW.id, NEW.organization_id, NEW.estado::text, NOW());

    -- AFTER trigger: hay que escribir la fila, asignar NEW no tiene efecto.
    -- GREATEST ignora el NULL de una orden sin garantía.
    IF NEW.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO') THEN
      UPDATE ordenes_servicio
      SET public_token_expires_at = GREATEST(
        NOW() + INTERVAL '30 days',
        (SELECT MAX(g.fecha_vencimiento) + INTERVAL '1 day' FROM garantias g WHERE g.orden_id = NEW.id)
      )
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- Se recrea igual que en la 068 para dejar fijo que es AFTER.
DROP TRIGGER IF EXISTS trg_orden_cambio_estado_tiempo ON ordenes_servicio;
CREATE TRIGGER trg_orden_cambio_estado_tiempo
  AFTER UPDATE OF estado ON ordenes_servicio
  FOR EACH ROW
  EXECUTE FUNCTION registrar_cambio_estado_tiempo();

-- ----------------------------------------------------------------------------
-- 3. Una garantía nueva o extendida estira el token de su orden
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION extender_token_publico_por_garantia()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ordenes_servicio
  SET public_token_expires_at = NEW.fecha_vencimiento + INTERVAL '1 day'
  WHERE id = NEW.orden_id
    AND public_token_expires_at IS NOT NULL
    AND public_token_expires_at < NEW.fecha_vencimiento + INTERVAL '1 day';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION extender_token_publico_por_garantia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_garantia_extiende_token_publico ON garantias;
CREATE TRIGGER trg_garantia_extiende_token_publico
  AFTER INSERT OR UPDATE OF fecha_vencimiento ON garantias
  FOR EACH ROW
  EXECUTE FUNCTION extender_token_publico_por_garantia();

-- ----------------------------------------------------------------------------
-- 4. Backfill de tokens de órdenes con garantía
-- ----------------------------------------------------------------------------
UPDATE ordenes_servicio o
SET public_token_expires_at = g.fin
FROM (
  SELECT orden_id, MAX(fecha_vencimiento) + INTERVAL '1 day' AS fin
  FROM garantias
  GROUP BY orden_id
) g
WHERE g.orden_id = o.id
  AND o.public_token_expires_at IS NOT NULL
  AND o.public_token_expires_at < g.fin;
