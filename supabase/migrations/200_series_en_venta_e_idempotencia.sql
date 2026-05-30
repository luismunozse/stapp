-- ============================================
-- Migration 200: Series en venta + idempotencia
-- ============================================
-- Implementa la "fase 2" prometida en migración 175 (líneas 15-16): consumo de
-- inventario_series dentro de crear_venta_atomica. Además agrega idempotencia a
-- la creación de venta.
--
-- Cambios:
--   (A) crear_venta_atomica consume series inline para items con
--       inventario.trackea_series = true (auto FIFO + override por serieIds).
--       NO llama salida_serie (esa RPC decrementa stock e inserta movimiento;
--       llamarla aquí duplicaría ambos). El decremento de stock agregado no cambia.
--   (B) crear_venta_atomica persiste p_idempotency_key. Un índice único parcial
--       sobre (organization_id, idempotency_key) permite que la API trate la
--       violación 23505 como reintento idempotente.
--
-- HUMAN-REVIEW: crear_venta_atomica se reproduce desde migración 199 (líneas
-- 209-494). Diffear contra 199 antes de db push para confirmar que no hubo drift
-- de transcripción fuera de los bloques marcados (A)/(B).
-- ============================================

-- (B) Columna + índice de idempotencia
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN ventas.idempotency_key IS
  'Clave de idempotencia provista por el cliente (UUID por intento de checkout). '
  'Único por organización cuando no es NULL: un reintento con la misma clave no '
  'crea una segunda venta.';

CREATE UNIQUE INDEX IF NOT EXISTS ventas_idempotency_key_unique
  ON ventas (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
