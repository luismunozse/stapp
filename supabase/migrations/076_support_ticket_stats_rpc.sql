-- RPC para contar tickets por estado sin traer todos los registros
CREATE OR REPLACE FUNCTION support_ticket_stats()
RETURNS TABLE(estado TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT estado::TEXT, COUNT(*) as count
  FROM support_tickets
  GROUP BY estado;
$$;
