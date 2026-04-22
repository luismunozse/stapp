-- =============================================
-- 125: Atomic visto_count increment for cotizaciones
-- Reemplaza el patrón lectura+escritura en JS por un
-- UPDATE atómico vía RPC, evitando race conditions
-- cuando el link público se abre varias veces a la vez.
-- =============================================

CREATE OR REPLACE FUNCTION increment_cotizacion_visto(p_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE cotizaciones
  SET
    visto_count = COALESCE(visto_count, 0) + 1,
    visto_at = COALESCE(visto_at, NOW())
  WHERE id = p_id
    AND estado = 'ENVIADA'
    AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION increment_cotizacion_visto(TEXT) TO anon, authenticated, service_role;
