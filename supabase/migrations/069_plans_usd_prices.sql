-- Agregar columnas de precios en USD a la tabla plans
-- Esto permite manejar precios en ARS y USD desde la base de datos
-- sin depender de valores hardcodeados en el código

ALTER TABLE plans ADD COLUMN IF NOT EXISTS precio_mensual_usd DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS precio_anual_usd DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Actualizar precios del plan Premium
-- ARS: $19.999/mes, $191.990/año (MercadoPago)
-- USD: $14/mes, $134/año (~20% descuento anual) (LemonSqueezy)
UPDATE plans
SET
  precio_mensual = 19999,
  precio_anual = 191990,
  precio_mensual_usd = 14,
  precio_anual_usd = 134
WHERE tipo = 'PREMIUM';

-- Plan FREE permanece en 0
UPDATE plans
SET
  precio_mensual_usd = 0,
  precio_anual_usd = 0
WHERE tipo = 'FREE';
