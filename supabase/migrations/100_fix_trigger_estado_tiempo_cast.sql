-- ============================================
-- 100: Fix cast en trigger registrar_cambio_estado_tiempo
-- ============================================
-- Bug introducido en 068: el trigger compara
--   orden_tiempos_estado.estado (TEXT)
-- contra
--   ordenes_servicio.estado (enum estado_orden)
-- y Postgres no tiene cast implícito entre TEXT y un enum en operadores
-- de comparación, así que tira:
--   ERROR: operator does not exist: text = estado_orden
-- en CADA cambio de estado, abortando el UPDATE original de la orden.
--
-- Síntoma: pasar una orden de RECIBIDO a EN_DIAGNOSTICO (o cualquier otro
-- cambio de estado) falla con error 500 en el endpoint PATCH /api/ordenes/[id].
--
-- Fix: castear OLD.estado / NEW.estado a TEXT explícitamente.

CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    UPDATE orden_tiempos_estado
    SET fin = NOW()
    WHERE orden_id = NEW.id AND estado = OLD.estado::text AND fin IS NULL;

    INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
    VALUES (NEW.id, NEW.organization_id, NEW.estado::text, NOW());

    IF NEW.estado = 'ENTREGADO' THEN
      UPDATE ordenes_servicio
      SET public_token_expires_at = NOW() + INTERVAL '30 days'
      WHERE id = NEW.id AND public_token_expires_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
