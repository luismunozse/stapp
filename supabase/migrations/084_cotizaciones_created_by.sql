-- Agregar campo created_by a cotizaciones para filtrar por autor
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id);
