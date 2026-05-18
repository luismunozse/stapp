-- RPC para resetear atomicamente ordenes_mes_actual cuando periodo_inicio
-- quedo del mes anterior. Se llama desde checkPlanLimit() antes de leer el
-- contador, para evitar que un usuario quede bloqueado en Free (15/15) al
-- empezar el mes nuevo si todavia no inserto ninguna orden que dispare el
-- trigger AFTER INSERT.
--
-- UPDATE condicional + WHERE periodo_inicio < mes_actual garantiza idempotencia:
-- multiples llamadas concurrentes en el mismo mes no causan double-reset porque
-- la fila ya no matchea el filtro despues del primer UPDATE.
CREATE OR REPLACE FUNCTION reset_ordenes_mes_if_needed(org_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE organization_usage
  SET
    ordenes_mes_actual = 0,
    periodo_inicio = DATE_TRUNC('month', NOW())
  WHERE organization_id = org_id
    AND periodo_inicio < DATE_TRUNC('month', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION reset_ordenes_mes_if_needed(TEXT) IS
'Resetea ordenes_mes_actual a 0 si periodo_inicio corresponde a un mes anterior. Idempotente. Llamada desde checkPlanLimit() en lib/subscriptions.ts antes del pre-check de limite de ordenes.';
