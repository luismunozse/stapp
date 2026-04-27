-- =============================================
-- 139: Defaults técnicos de presupuestos por organización
-- Defaults usados al crear un presupuesto técnico:
--   * garantia_dias_default: días de garantía sugeridos (repuesto/mano obra/ambos)
--   * politica_abandono_dias_default: días tras notificación de listo antes de
--     declarar abandono
--   * anticipo_porcentaje_default: % de seña sugerido
-- =============================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS garantia_dias_default INTEGER DEFAULT 30;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS politica_abandono_dias_default INTEGER DEFAULT 60;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS anticipo_porcentaje_default NUMERIC(5,2) DEFAULT 50;

COMMENT ON COLUMN organizations.garantia_dias_default IS 'Días de garantía sugeridos para nuevos presupuestos técnicos';
COMMENT ON COLUMN organizations.politica_abandono_dias_default IS 'Días tras aviso de listo para retirar antes de declarar equipo abandonado';
COMMENT ON COLUMN organizations.anticipo_porcentaje_default IS 'Porcentaje de seña/anticipo sugerido al iniciar la reparación';

-- Tipo de repuesto por ítem (disclosure legal en presupuestos técnicos)
ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS tipo_repuesto TEXT DEFAULT 'NO_APLICA'
  CHECK (tipo_repuesto IN ('ORIGINAL', 'ALTERNATIVO', 'RECICLADO', 'NO_APLICA'));

COMMENT ON COLUMN items_cotizacion.tipo_repuesto IS 'Tipo de repuesto: ORIGINAL/ALTERNATIVO/RECICLADO/NO_APLICA (servicio o mano de obra)';
