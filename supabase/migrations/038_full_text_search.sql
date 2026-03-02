-- ============================================
-- Migration 038: Full-Text Search con tsvector
-- ============================================

-- Agregar columnas de búsqueda vectorial
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Función para actualizar vector de búsqueda de clientes
CREATE OR REPLACE FUNCTION clientes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.nombre, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.email, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.telefono, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.dni, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.direccion, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar vector de búsqueda de órdenes
CREATE OR REPLACE FUNCTION ordenes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.dispositivo, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.problema_reportado, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.diagnostico, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(NEW.observaciones, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(NEW.marca, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS clientes_search_update ON clientes;
CREATE TRIGGER clientes_search_update
  BEFORE INSERT OR UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION clientes_search_vector_update();

DROP TRIGGER IF EXISTS ordenes_search_update ON ordenes_servicio;
CREATE TRIGGER ordenes_search_update
  BEFORE INSERT OR UPDATE ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION ordenes_search_vector_update();

-- Índices GIN para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_clientes_search ON clientes USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_ordenes_search ON ordenes_servicio USING gin(search_vector);

-- Backfill de registros existentes
UPDATE clientes SET search_vector =
  setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(email, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(telefono, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(dni, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(direccion, '')), 'D');

UPDATE ordenes_servicio SET search_vector =
  setweight(to_tsvector('spanish', coalesce(dispositivo, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(problema_reportado, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(diagnostico, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(observaciones, '')), 'C') ||
  setweight(to_tsvector('spanish', coalesce(marca, '')), 'C');

-- Función RPC para búsqueda unificada
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
  -- Crear query de búsqueda (soporta búsqueda parcial)
  ts_query := plainto_tsquery('spanish', search_query);

  -- Si la query está vacía, intentar con prefijo
  IF ts_query = ''::tsquery THEN
    ts_query := to_tsquery('spanish', search_query || ':*');
  END IF;

  -- Buscar clientes
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

  -- Buscar órdenes
  IF search_type = 'all' OR search_type = 'ordenes' THEN
    result := result || jsonb_build_object('ordenes', (
      SELECT coalesce(jsonb_agg(row_to_json(o.*)), '[]'::jsonb)
      FROM (
        SELECT os.id, os.numero_orden, os.dispositivo, os.estado,
               os.problema_reportado, os.marca,
               cl.nombre as cliente_nombre,
               ts_rank(os.search_vector, ts_query) as relevance
        FROM ordenes_servicio os
        LEFT JOIN clientes cl ON cl.id = os.cliente_id
        WHERE os.organization_id = org_id
          AND (
            os.search_vector @@ ts_query
            OR os.dispositivo ILIKE '%' || search_query || '%'
            OR os.problema_reportado ILIKE '%' || search_query || '%'
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
