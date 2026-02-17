-- Add public_token and signature fields to cotizaciones

-- Public token for shareable links (same pattern as ordenes_servicio)
ALTER TABLE cotizaciones
ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

-- Signature fields for approval (base64 stored directly)
ALTER TABLE cotizaciones
ADD COLUMN IF NOT EXISTS firma_aprobacion TEXT,
ADD COLUMN IF NOT EXISTS firma_mime TEXT;

-- Index for fast token lookup
CREATE UNIQUE INDEX IF NOT EXISTS cotizaciones_public_token_idx
ON cotizaciones(public_token)
WHERE public_token IS NOT NULL;

-- Generate tokens for existing cotizaciones
UPDATE cotizaciones
SET public_token = encode(gen_random_bytes(16), 'hex')
WHERE public_token IS NULL;
