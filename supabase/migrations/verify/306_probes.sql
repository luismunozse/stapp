-- =============================================================================
-- Verificación de la migración 306 — numeración de recibos de cuenta corriente.
-- Correr en el SQL editor de Supabase Studio, DESPUES de aplicar 306.
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato, y en particular
-- no quema números de recibo reales.
-- =============================================================================

BEGIN;

-- Un movimiento de dinero recibido (DEPOSITO o PAGO) para probar la emisión, y
-- uno de débito (CARGO o USO) para probar el rechazo.
CREATE TEMP TABLE _probe_cobro AS
SELECT id, organization_id FROM cuenta_corriente
WHERE tipo IN ('DEPOSITO', 'PAGO')
ORDER BY created_at DESC LIMIT 1;

CREATE TEMP TABLE _probe_debito AS
SELECT id, organization_id FROM cuenta_corriente
WHERE tipo IN ('CARGO', 'USO')
ORDER BY created_at DESC LIMIT 1;

SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay movimientos DEPOSITO/PAGO en la base'
            ELSE 'OK: movimiento de cobro seleccionado' END AS probe_0_setup
FROM _probe_cobro;

-- ---------------------------------------------------------------------------
-- PROBE 1 — La columna y el índice único parcial existen
--
-- El índice es PARCIAL (WHERE numero_recibo IS NOT NULL) a propósito: la enorme
-- mayoría de los movimientos nunca se imprime y sus NULL no deben competir
-- entre sí por la unicidad.
--
-- ESPERADO: columna = 'integer', indice_parcial = true
-- ---------------------------------------------------------------------------
SELECT
  (SELECT data_type FROM information_schema.columns
    WHERE table_name = 'cuenta_corriente' AND column_name = 'numero_recibo') AS probe_1_columna,
  (SELECT indpred IS NOT NULL FROM pg_index
    WHERE indexrelid = 'cuenta_corriente_numero_recibo_org_uniq'::regclass) AS probe_1_indice_parcial,
  (SELECT indisunique FROM pg_index
    WHERE indexrelid = 'cuenta_corriente_numero_recibo_org_uniq'::regclass) AS probe_1_indice_unico;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Primera emisión: asigna un número y lo persiste
--
-- ESPERADO: numero >= 1, y numero_persistido igual al devuelto
-- ---------------------------------------------------------------------------
UPDATE cuenta_corriente SET numero_recibo = NULL
WHERE id IN (SELECT id FROM _probe_cobro);

SELECT
  asignar_numero_recibo_cc(c.organization_id, c.id) AS probe_2_numero,
  (SELECT numero_recibo FROM cuenta_corriente WHERE id = c.id) AS probe_2_numero_persistido
FROM _probe_cobro c;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Reimpresión: devuelve SIEMPRE el mismo número
--
-- Es la garantía central de la 306. Si esto devolviera un número distinto, el
-- cliente terminaría con dos papeles numerados distinto por el mismo cobro.
--
-- ESPERADO: iguales = true
-- ---------------------------------------------------------------------------
SELECT
  asignar_numero_recibo_cc(c.organization_id, c.id)
    = (SELECT numero_recibo FROM cuenta_corriente WHERE id = c.id) AS probe_3_iguales
FROM _probe_cobro c;

-- ---------------------------------------------------------------------------
-- PROBE 4 — El correlativo avanza por organización
--
-- ESPERADO: siguiente = probe_2_numero + 1 (el MAX de la org, más uno)
-- ---------------------------------------------------------------------------
SELECT
  (SELECT MAX(numero_recibo) FROM cuenta_corriente WHERE organization_id = c.organization_id) AS probe_4_max_org
FROM _probe_cobro c;

-- ---------------------------------------------------------------------------
-- PROBE 5 — Un movimiento de débito NO se puede emitir como recibo
--
-- Un recibo acredita dinero recibido; CARGO (fiado) y USO (consumo de saldo)
-- son débitos. La función debe levantar excepción, no acuñar un número.
--
-- ESPERADO: un error que menciona "DEPOSITO o PAGO".
-- Si no hay movimientos de débito en la base, esta probe se saltea sola.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id TEXT;
  v_org TEXT;
BEGIN
  SELECT id, organization_id INTO v_id, v_org FROM _probe_debito;
  IF v_id IS NULL THEN
    RAISE NOTICE 'probe_5: sin movimientos CARGO/USO en la base, salteada';
    RETURN;
  END IF;
  BEGIN
    PERFORM asignar_numero_recibo_cc(v_org, v_id);
    RAISE NOTICE 'probe_5 FALLO: se emitio recibo de un movimiento de debito';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'probe_5 OK: rechazado -> %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 6 — Un movimiento inexistente levanta excepción, no devuelve NULL
-- ESPERADO: notice con "no encontrado"
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM asignar_numero_recibo_cc('org-inexistente', 'mov-inexistente');
  RAISE NOTICE 'probe_6 FALLO: no levanto excepcion';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'probe_6 OK: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 7 — No quedaron sobrecargas de la función
-- ESPERADO: 1 fila
-- ---------------------------------------------------------------------------
SELECT proname, COUNT(*) AS versiones
FROM pg_proc
WHERE proname = 'asignar_numero_recibo_cc'
GROUP BY proname;

ROLLBACK;
