-- ========================================
-- 159: Motivo de entrega sin cobro
-- ========================================
-- ENTREGADO_SIN_COBRO puede corresponder a varios casos de negocio:
--   - NO_REPARABLE      : equipo no se pudo reparar (no se cobra dx)
--   - CORTESIA          : reparado pero técnico decide no cobrar
--   - GARANTIA          : reingreso bajo garantía vigente
--   - CLIENTE_DESISTIO  : cliente aprobó presupuesto y luego se arrepintió
--   - OTRO              : caso no listado
--
-- El motivo determina cómo se muestra el stepper en el seguimiento
-- público y el label en el card de estado.
-- ========================================

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS motivo_sin_cobro TEXT
  CHECK (
    motivo_sin_cobro IS NULL OR
    motivo_sin_cobro IN ('NO_REPARABLE', 'CORTESIA', 'GARANTIA', 'CLIENTE_DESISTIO', 'OTRO')
  );

COMMENT ON COLUMN ordenes_servicio.motivo_sin_cobro IS
  'Motivo de entrega sin cobro. Solo aplica cuando estado=ENTREGADO_SIN_COBRO. NULL para órdenes legacy.';

-- Backfill: marcar como NO_REPARABLE las órdenes existentes que vienen
-- de SIN_REPARACION (heurística más segura para historial).
UPDATE ordenes_servicio
SET motivo_sin_cobro = 'NO_REPARABLE'
WHERE estado = 'ENTREGADO_SIN_COBRO'
  AND motivo_sin_cobro IS NULL;
