-- ========================================
-- Migration 216: TURNOS — sucursal_id SET NOT NULL (diferido de 215)
-- ========================================
-- Aplicar SOLO después de:
--   1. Migración 215 aplicada en prod (columna + backfill)
--   2. Deploy del código de Fase 4 (POST /api/turnos ya escribe sucursal_id)
--   3. Verificado SELECT COUNT(*) FROM turnos WHERE sucursal_id IS NULL = 0
--
-- Pre-chequeo defensivo: aborta si quedó alguna fila con sucursal_id NULL
-- (mismo patrón que migración 207).

DO $$
DECLARE
  v_nulos INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_nulos FROM turnos WHERE sucursal_id IS NULL;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION 'Abort: % turno(s) con sucursal_id NULL. Backfillear antes de SET NOT NULL.', v_nulos;
  END IF;
END $$;

ALTER TABLE turnos ALTER COLUMN sucursal_id SET NOT NULL;
