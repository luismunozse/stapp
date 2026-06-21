-- ============================================
-- Migration 239: Add p_sucursal_id to search_all RPC
-- ============================================
-- Extends search_all() to accept an optional branch filter.
-- When p_sucursal_id is non-NULL, the ordenes subquery is scoped to that
-- branch. The clientes subquery is org-wide and is left unchanged.
--
-- NOTE: Applied manually via Supabase SQL editor (no CLI migration runner).
--
-- Why DROP before CREATE:
--   Adding a parameter to an existing overloaded function creates a NEW
--   overload instead of replacing the old one. We drop the old 4-arg
--   signature first to avoid accumulating stale overloads.

-- 1. Drop the old 4-arg signature (from migration 162)
DROP FUNCTION IF EXISTS search_all(TEXT, text, text, integer);

-- 2. Recreate with the new optional p_sucursal_id parameter
CREATE OR REPLACE FUNCTION search_all(
  org_id TEXT,
  search_query text,
  search_type text DEFAULT 'all',
  max_results integer DEFAULT 10,
  p_sucursal_id TEXT DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  result jsonb := '{}';
  ts_query tsquery;
BEGIN
  ts_query := plainto_tsquery('spanish', search_query);

  IF ts_query = ''::tsquery THEN
    ts_query := to_tsquery('spanish', search_query || ':*');
  END IF;

  IF search_type = 'all' OR search_type = 'clientes' THEN
    result := result || jsonb_build_object('clientes', (
      SELECT coalesce(jsonb_agg(row_to_json(c.*)), '[]'::jsonb)
      FROM (
        SELECT id, nombre, telefono, email, dni,
               ts_rank(search_vector, ts_query) as relevance
        FROM clientes
        WHERE organization_id = org_id
          AND (
            search_vector @@ ts_query
            OR nombre ILIKE '%' || search_query || '%'
            OR telefono ILIKE '%' || search_query || '%'
            OR dni ILIKE '%' || search_query || '%'
          )
        ORDER BY relevance DESC
        LIMIT max_results
      ) c
    ));
  END IF;

  IF search_type = 'all' OR search_type = 'ordenes' THEN
    result := result || jsonb_build_object('ordenes', (
      SELECT coalesce(jsonb_agg(row_to_json(o.*)), '[]'::jsonb)
      FROM (
        SELECT os.id, os.numero_orden, os.dispositivo, os.estado,
               os.problema_reportado, os.marca, os.imei,
               cl.nombre as cliente_nombre,
               ts_rank(os.search_vector, ts_query) as relevance
        FROM ordenes_servicio os
        LEFT JOIN clientes cl ON cl.id = os.cliente_id
        WHERE os.organization_id = org_id
          AND (p_sucursal_id IS NULL OR os.sucursal_id = p_sucursal_id)
          AND (
            os.search_vector @@ ts_query
            OR os.dispositivo ILIKE '%' || search_query || '%'
            OR os.problema_reportado ILIKE '%' || search_query || '%'
            OR os.imei ILIKE '%' || search_query || '%'
            OR CAST(os.numero_orden AS text) = search_query
          )
        ORDER BY relevance DESC
        LIMIT max_results
      ) o
    ));
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
