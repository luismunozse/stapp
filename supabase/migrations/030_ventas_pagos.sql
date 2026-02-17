-- Sistema de pagos para ventas (mismo modelo que pagos_parciales en facturación)

-- Agregar nuevos métodos de pago al enum metodo_pago_venta
ALTER TYPE metodo_pago_venta ADD VALUE IF NOT EXISTS 'TARJETA_DEBITO';
ALTER TYPE metodo_pago_venta ADD VALUE IF NOT EXISTS 'TARJETA_CREDITO';
ALTER TYPE metodo_pago_venta ADD VALUE IF NOT EXISTS 'MERCADOPAGO';
ALTER TYPE metodo_pago_venta ADD VALUE IF NOT EXISTS 'OTRO';

-- Agregar campos de seguimiento de pagos a ventas
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS monto_abonado DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'PAGADO';

-- Backfill: ventas completadas ya están pagadas en su totalidad
UPDATE ventas SET monto_abonado = total, estado_pago = 'PAGADO' WHERE estado = 'COMPLETADA';
UPDATE ventas SET estado_pago = 'ANULADA' WHERE estado = 'ANULADA';

-- Crear tabla de pagos individuales para ventas (usa metodo_pago_venta, mismo enum que ventas)
CREATE TABLE IF NOT EXISTS pagos_venta (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  venta_id TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  monto DECIMAL(10,2) NOT NULL,
  metodo_pago metodo_pago_venta NOT NULL,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  numero_referencia TEXT,
  observaciones TEXT,
  cuotas INTEGER,
  recargo_porcentaje DECIMAL(5,2),
  monto_original DECIMAL(10,2)
);

CREATE INDEX IF NOT EXISTS pagos_venta_venta_id_idx ON pagos_venta(venta_id);

-- RLS
ALTER TABLE pagos_venta ENABLE ROW LEVEL SECURITY;

-- Crear registros de pago iniciales para ventas completadas existentes
INSERT INTO pagos_venta (venta_id, monto, metodo_pago)
SELECT id, total, metodo_pago FROM ventas WHERE estado = 'COMPLETADA';
