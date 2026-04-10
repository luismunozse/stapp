-- Phone number to contact the client for this specific order.
-- Useful when the client leaves their phone for repair and needs
-- to be reached at a different number.
-- If NULL, notifications fall back to clientes.telefono.
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;
