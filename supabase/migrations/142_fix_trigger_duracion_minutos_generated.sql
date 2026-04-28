-- ============================================
-- 142: Fix UPDATE de duracion_minutos en registrar_cambio_estado_tiempo
-- ============================================
-- Migration 140 agregó "duracion_minutos = ..." al UPDATE pero la columna
-- es GENERATED (computada automáticamente). PostgreSQL rechaza UPDATEar
-- columnas generadas con error 428C9.
-- Fix: quitar la línea — la columna se actualiza sola al cambiar fin.

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
