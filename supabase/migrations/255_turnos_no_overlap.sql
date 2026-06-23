-- applied manually in Supabase SQL editor
-- Migration 255: Prevent técnico double-booking via exclusion constraint
-- Estados activos: agendado, confirmado, en_camino, realizado, orden_generada
-- Estados terminales (excluidos): cancelado, no_show

-- ============================================================
-- 1) Require btree_gist extension for the exclusion constraint
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- 2) Safety guard: detect existing overlapping ACTIVE turnos
--    before adding the constraint (would fail otherwise).
-- ============================================================
DO $$
DECLARE
  v_count INT;
  v_detail TEXT;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM turnos t1
  JOIN turnos t2
    ON t1.organization_id = t2.organization_id
    AND t1.tecnico_id      = t2.tecnico_id
    AND t1.id              < t2.id
    AND t1.tecnico_id IS NOT NULL
    AND t1.estado NOT IN ('cancelado', 'no_show')
    AND t2.estado NOT IN ('cancelado', 'no_show')
    AND tstzrange(t1.inicio, COALESCE(t1.fin, t1.inicio + interval '30 minutes'))
     && tstzrange(t2.inicio, COALESCE(t2.fin, t2.inicio + interval '30 minutes'));

  IF v_count > 0 THEN
    SELECT string_agg(
      format('turno %s vs turno %s (tecnico %s, org %s)', t1.id, t2.id, t1.tecnico_id, t1.organization_id),
      E'\n'
    )
    INTO v_detail
    FROM turnos t1
    JOIN turnos t2
      ON t1.organization_id = t2.organization_id
      AND t1.tecnico_id      = t2.tecnico_id
      AND t1.id              < t2.id
      AND t1.tecnico_id IS NOT NULL
      AND t1.estado NOT IN ('cancelado', 'no_show')
      AND t2.estado NOT IN ('cancelado', 'no_show')
      AND tstzrange(t1.inicio, COALESCE(t1.fin, t1.inicio + interval '30 minutes'))
       && tstzrange(t2.inicio, COALESCE(t2.fin, t2.inicio + interval '30 minutes'));

    RAISE EXCEPTION 'Cannot add no-overlap constraint: % existing overlapping active turno pairs found.%Details:%',
      v_count, E'\n', v_detail;
  END IF;
END;
$$;

-- ============================================================
-- 3) Drop constraint if it already exists (idempotent re-run)
-- ============================================================
ALTER TABLE turnos
  DROP CONSTRAINT IF EXISTS turnos_no_overlap_tecnico;

-- ============================================================
-- 4) Add exclusion constraint
--    Blocks simultaneous active turnos for the same técnico
--    within the same organization.
--    Turnos with estado IN ('cancelado', 'no_show') are excluded.
--    Turnos without tecnico_id are excluded.
-- ============================================================
ALTER TABLE turnos
  ADD CONSTRAINT turnos_no_overlap_tecnico
  EXCLUDE USING gist (
    organization_id                                              WITH =,
    tecnico_id                                                   WITH =,
    tstzrange(inicio, COALESCE(fin, inicio + interval '30 minutes')) WITH &&
  )
  WHERE (
    estado NOT IN ('cancelado', 'no_show')
    AND tecnico_id IS NOT NULL
  );

-- ============================================================
-- 5) Supporting GiST index for fast overlap queries (optional
--    but recommended — the constraint already creates one, this
--    is explicit documentation of the index structure).
-- ============================================================
-- Note: Postgres creates an implicit index for EXCLUDE constraints.
-- No extra CREATE INDEX needed.
