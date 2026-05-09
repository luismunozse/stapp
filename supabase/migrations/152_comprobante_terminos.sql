-- Add custom terms and conditions for thermal receipt per organization
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS comprobante_terminos TEXT;

COMMENT ON COLUMN organizations.comprobante_terminos IS 'Custom terms and conditions printed at the bottom of the thermal service order receipt.';
