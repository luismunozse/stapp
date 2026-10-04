-- 336: Rate limit compartido entre instancias (contador en Postgres).
--
-- lib/rate-limit.ts vive en memoria: cada instancia serverless tiene su propio
-- Map, asi que el tope real es (tope x instancias). Esta tabla + RPC dan un
-- contador unico. Se usa primero en POST /api/public/catalogo/[slug]/cotizar.
--
-- Aditiva y re-ejecutable. Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una
-- transaccion propia). No toca tablas existentes.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Para el barrido por antiguedad.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
  ON rate_limit_buckets (window_start);

-- RLS activo y SIN policies: solo el service role (que la salta) la toca.
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- true = permitido, false = tope superado. Ventana fija: el bucket es el
-- multiplo de p_window_seconds que contiene a now(). El upsert es atomico, asi
-- que dos requests concurrentes nunca leen el mismo count.
CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_key            TEXT,
  p_max            INT,
  p_window_seconds INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_window TIMESTAMPTZ;
  v_count  INT;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_max IS NULL OR p_max < 1 THEN
    RAISE EXCEPTION 'rate_limit_hit: p_max y p_window_seconds deben ser >= 1' USING ERRCODE = '22023';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO rate_limit_buckets AS b (key, window_start, count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = b.count + 1
  RETURNING b.count INTO v_count;

  RETURN v_count <= p_max;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM authenticated;

-- Barre buckets de mas de 2 dias (la ventana mas larga en uso es 1 dia).
-- La llama el cron diario catalogo-pii-purge. Devuelve cuantas filas borro.
CREATE OR REPLACE FUNCTION limpiar_rate_limit_buckets() RETURNS INT AS $$
DECLARE
  v_borradas INT;
BEGIN
  DELETE FROM rate_limit_buckets WHERE window_start < now() - INTERVAL '2 days';
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  RETURN v_borradas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION limpiar_rate_limit_buckets() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION limpiar_rate_limit_buckets() FROM anon;
REVOKE EXECUTE ON FUNCTION limpiar_rate_limit_buckets() FROM authenticated;

COMMENT ON TABLE rate_limit_buckets IS
  'Contadores de rate limit por (key, ventana fija). Solo service role. Barrida diaria por limpiar_rate_limit_buckets(). v336.';
