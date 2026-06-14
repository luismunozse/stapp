-- 217: opt-out de WhatsApp por cliente. Default true (todos reciben salvo desmarcar).
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS acepta_whatsapp BOOLEAN NOT NULL DEFAULT true;
