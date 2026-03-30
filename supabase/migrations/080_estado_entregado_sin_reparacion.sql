-- Agregar nuevo estado ENTREGADO_SIN_REPARACION al enum estado_orden
-- Este estado se usa cuando un equipo no pudo ser reparado y el cliente lo retira.
ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'ENTREGADO_SIN_REPARACION';

-- Actualizar el trigger de tiempos de estado para manejar el nuevo estado terminal
-- (el trigger existente ya maneja cualquier cambio de estado genéricamente,
--  solo necesitamos asegurar que el token expire también para este nuevo estado)
CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    -- Cerrar el tiempo del estado anterior
    UPDATE orden_tiempos_estado
    SET fin = NOW(),
        duracion_minutos = EXTRACT(EPOCH FROM (NOW() - inicio)) / 60
    WHERE orden_id = NEW.id AND estado = OLD.estado AND fin IS NULL;

    -- Abrir nuevo tiempo para el estado actual
    INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
    VALUES (NEW.id, NEW.organization_id, NEW.estado, NOW());

    -- Si es ENTREGADO o ENTREGADO_SIN_REPARACION, expirar token en 30 días
    IF NEW.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION') THEN
      NEW.public_token_expires_at := NOW() + INTERVAL '30 days';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
