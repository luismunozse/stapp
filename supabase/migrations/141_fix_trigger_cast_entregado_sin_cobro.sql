-- ============================================
-- 141: Fix cast en trigger registrar_cambio_estado_tiempo
-- ============================================
-- Migration 140 hizo CREATE OR REPLACE sin los ::text casts que 100 había fijado.
-- orden_tiempos_estado.estado es TEXT, ordenes_servicio.estado es enum estado_orden.
-- Sin cast explícito: operator does not exist: text = estado_orden (code 42883).
-- Este migration restaura los casts + conserva todas las mejoras de 140.

CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    UPDATE orden_tiempos_estado
    SET fin = NOW(),
        duracion_minutos = EXTRACT(EPOCH FROM (NOW() - inicio)) / 60
    WHERE orden_id = NEW.id AND estado = OLD.estado::text AND fin IS NULL;

    INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
    VALUES (NEW.id, NEW.organization_id, NEW.estado::text, NOW());

    IF NEW.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO') THEN
      NEW.public_token_expires_at := NOW() + INTERVAL '30 days';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
