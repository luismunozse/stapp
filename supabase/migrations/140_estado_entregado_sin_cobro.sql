-- Nuevo estado para órdenes diagnosticadas/reparadas que se entregan sin cobro
ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'ENTREGADO_SIN_COBRO';

-- Actualizar trigger para expirar token también en ENTREGADO_SIN_COBRO
CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    UPDATE orden_tiempos_estado
    SET fin = NOW(),
        duracion_minutos = EXTRACT(EPOCH FROM (NOW() - inicio)) / 60
    WHERE orden_id = NEW.id AND estado = OLD.estado AND fin IS NULL;

    INSERT INTO orden_tiempos_estado (orden_id, organization_id, estado, inicio)
    VALUES (NEW.id, NEW.organization_id, NEW.estado, NOW());

    IF NEW.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO') THEN
      NEW.public_token_expires_at := NOW() + INTERVAL '30 days';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
