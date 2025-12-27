-- ========================================
-- AGREGAR ESTADO ANULADA PARA FACTURAS
-- ========================================
-- Permite anular facturas sin eliminarlas (para auditoría contable)

-- Agregar nuevo valor al enum estado_pago
ALTER TYPE estado_pago ADD VALUE IF NOT EXISTS 'ANULADA';

-- Comentario para documentación
COMMENT ON TYPE estado_pago IS 'Estados de pago para facturas:
PENDIENTE: Factura sin pagos
PAGADO_PARCIAL: Factura con pagos parciales
PAGADO: Factura completamente pagada
ANULADA: Factura anulada (no se eliminó para auditoría)';
