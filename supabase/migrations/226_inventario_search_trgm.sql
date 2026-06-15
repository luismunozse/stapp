-- ========================================
-- 226 — Trigram indexes for inventory search (POS / sale pickers)
-- ========================================
-- The product search (/api/inventario/search) now matches by substring on
-- nombre + codigo via ILIKE (it previously used full-text search, which missed
-- partial words and alphanumeric codes). ILIKE '%term%' has a leading wildcard,
-- so a btree index can't help it. pg_trgm GIN indexes make these substring
-- searches index-assisted, keeping POS search fast on large catalogs.
--
-- Purely additive: no data change, no app-code dependency. Safe to apply any
-- time (the route works with or without these indexes — they only affect speed).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes support both LIKE and ILIKE substring matching.
CREATE INDEX IF NOT EXISTS idx_inventario_nombre_trgm
  ON inventario USING gin (nombre gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventario_codigo_trgm
  ON inventario USING gin (codigo gin_trgm_ops)
  WHERE deleted_at IS NULL;
