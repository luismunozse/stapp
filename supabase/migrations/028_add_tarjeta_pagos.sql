-- Extender enum metodo_pago con nuevos métodos de pago
ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'TARJETA_DEBITO';
ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'TARJETA_CREDITO';
ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'MERCADOPAGO';
ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'OTRO';

-- Agregar campos de cuotas y recargo a pagos_parciales
ALTER TABLE pagos_parciales
  ADD COLUMN IF NOT EXISTS cuotas INTEGER,
  ADD COLUMN IF NOT EXISTS recargo_porcentaje DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS monto_original DECIMAL(10,2);
