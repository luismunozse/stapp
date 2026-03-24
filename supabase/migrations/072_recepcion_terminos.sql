-- Add custom terms and conditions for reception receipts per organization
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS recepcion_terminos TEXT;

COMMENT ON COLUMN organizations.recepcion_terminos IS 'Custom terms and conditions shown on reception receipts (PDF). If null, default terms are used.';
