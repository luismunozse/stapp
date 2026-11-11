-- Rollback de garantias_desde_entrega (399).
--
-- Vuelve la función del trigger de estados a la versión de la 142 (la que
-- asigna NEW en un trigger AFTER y no escribe el vencimiento), quita el
-- trigger de garantías y borra las columnas de condiciones del presupuesto.
-- Las condiciones guardadas en órdenes no entregadas se pierden: esas entregas
-- vuelven a usar los días por defecto de la org.
-- El backfill de public_token_expires_at no se revierte: solo estiró links
-- hasta el fin de la garantía.
--
-- Desplegar antes el código anterior: convertir-orden escribe estas columnas.

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS trg_garantia_extiende_token_publico ON garantias;
DROP FUNCTION IF EXISTS extender_token_publico_por_garantia();

CREATE OR REPLACE FUNCTION registrar_cambio_estado_tiempo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    UPDATE orden_tiempos_estado
    SET fin = NOW()
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

ALTER TABLE ordenes_servicio DROP CONSTRAINT IF EXISTS ordenes_servicio_garantia_presupuesto_dias_check;
ALTER TABLE ordenes_servicio DROP CONSTRAINT IF EXISTS ordenes_servicio_garantia_presupuesto_alcance_check;
ALTER TABLE ordenes_servicio
  DROP COLUMN IF EXISTS garantia_presupuesto_dias,
  DROP COLUMN IF EXISTS garantia_presupuesto_alcance;
