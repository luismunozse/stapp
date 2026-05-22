-- ============================================
-- Migration 180: Plantillas WhatsApp personalizables
-- ============================================
-- Permite a cada organizacion definir plantillas custom para mensajes
-- de WhatsApp al compartir comprobantes. Variables soportadas:
--   {cliente}, {numero}, {total}, {items}, {metodo_pago}, {garantias}, {empresa}, {fecha}

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plantillas_whatsapp JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN organizations.plantillas_whatsapp IS
  'Plantillas de mensajes WhatsApp personalizables por organizacion. Keys: comprobante_venta (texto completo), comprobante_venta_corto (texto que acompana imagen).';
