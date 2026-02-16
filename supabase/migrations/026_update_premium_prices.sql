-- Actualizar precios del plan Premium
-- ARS: $19.999/mes, $191.990/año
-- USD: $12/mes, $115/año (via LemonSqueezy)

UPDATE plans
SET
  precio_mensual = 19999,
  precio_anual = 191990
WHERE tipo = 'PREMIUM';
