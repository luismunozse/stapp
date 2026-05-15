-- ============================================
-- Migration 162: Incluir IMEI en búsqueda de órdenes
-- ============================================
-- Extiende el search_vector y la RPC search_all para que el
-- buscador global y el FTS encuentren órdenes por IMEI / N° de serie.

-- 1. Trigger: agregar imei al vector de búsqueda
CREATE OR REPLACE FUNCTION ordenes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.dispositivo, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.problema_reportado, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.imei, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.diagnostico, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.observaciones, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.marca, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Backfill de search_vector incluyendo imei
UPDATE ordenes_servicio SET search_vector =
  setweight(to_tsvector('spanish', coalesce(dispositivo, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(problema_reportado, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(imei, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(diagnostico, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(observaciones, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(marca, '')), 'C');

-- 3. RPC search_all: agregar imei al SELECT y al WHERE de órdenes
CREATE OR REPLACE FUNCTION search_all(
  org_id TEXT,
  search_query text,
  search_type text DEFAULT 'all',
  max_results integer DEFAULT 10
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
