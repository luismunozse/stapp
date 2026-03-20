-- Add firma_cliente (base64) and firma_mime columns to checklist_recepcion
ALTER TABLE checklist_recepcion
ADD COLUMN IF NOT EXISTS firma_cliente TEXT,
ADD COLUMN IF NOT EXISTS firma_mime TEXT;
