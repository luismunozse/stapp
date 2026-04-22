-- =============================================
-- 126: Cotizaciones - tipo PRESUPUESTO
-- Permite dos tipos de cotizaciones:
--   * ORDEN       -> nace de una orden de servicio real (flujo con firma, reservas)
--   * PRESUPUESTO -> documento plano (ej. para aseguradora). Snapshot de equipo
--                    + checklist directamente en la cotización, sin firma ni
--                    reservas de stock. Puede convertirse a una orden real.
-- =============================================

-- Tipo de cotización
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'ORDEN'
  CHECK (tipo IN ('ORDEN', 'PRESUPUESTO'));

-- Snapshot del equipo (solo para PRESUPUESTO)
-- Shape:
-- {
--   "dispositivo": "iPhone 13",
--   "tipoDispositivoId": "xxxx",
--   "tipoDispositivo": "CELULAR",
--   "marca": "Apple",
--   "modelo": "13 Pro",
--   "color": "Negro",
--   "imei": "xxxx",
--   "numeroSerie": "xxxx",
--   "accesorios": "Cargador, caja",
--   "problemaReportado": "Pantalla rota"
-- }
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS equipo_snapshot JSONB DEFAULT NULL;

-- Snapshot del checklist (solo para PRESUPUESTO)
-- Shape:
-- {
--   "templateId": "xxx",
--   "tipoDispositivoId": "xxx",
--   "valores": { "item_id_1": true, "item_id_2": "texto" },
--   "notas": "..."
-- }
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS checklist_snapshot JSONB DEFAULT NULL;

-- Si un PRESUPUESTO se convirtió en orden real, guardamos el vínculo
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS convertida_a_orden_id TEXT DEFAULT NULL
  REFERENCES ordenes_servicio(id) ON DELETE SET NULL;

-- Índices para filtros por tipo
CREATE INDEX IF NOT EXISTS idx_cotizaciones_tipo_org
  ON cotizaciones(organization_id, tipo)
  WHERE deleted_at IS NULL;

-- Comentarios
COMMENT ON COLUMN cotizaciones.tipo IS 'ORDEN (ligada a orden real) o PRESUPUESTO (doc plano, ej. seguro)';
COMMENT ON COLUMN cotizaciones.equipo_snapshot IS 'Datos del equipo capturados en la cotización tipo PRESUPUESTO';
COMMENT ON COLUMN cotizaciones.checklist_snapshot IS 'Checklist de recepción capturado en la cotización tipo PRESUPUESTO';
COMMENT ON COLUMN cotizaciones.convertida_a_orden_id IS 'Si el PRESUPUESTO fue convertido a orden real, ID de la orden creada';
