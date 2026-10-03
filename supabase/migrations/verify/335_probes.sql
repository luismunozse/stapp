-- Probes de la 335. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply.
--
-- Fijan el backfill: devoluciones, notas de credito, recurrentes y COGS se
-- marcan; un "Retiro de socio" (tambien afecta_rentabilidad = false) y un
-- gasto comun quedan MANUAL. Ademas, el CHECK rechaza un origen desconocido.
-- Se inserta con origen por defecto y se corre el mismo UPDATE de la migracion
-- sobre filas de prueba (la columna ya existe al correr esto).
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-335', 'Probe 335', 'Probe 335', 'probe-335');

INSERT INTO movimientos_caja (id, organization_id, tipo, monto, metodo_pago, concepto, afecta_rentabilidad, es_recurrente)
VALUES
  ('mov-335-dev',  'org-probe-335', 'EGRESO', 100, 'EFECTIVO', 'Devolución DEV-0001',        false, false),
  ('mov-335-nc',   'org-probe-335', 'EGRESO', 100, 'EFECTIVO', 'Nota de crédito NC-0001',    false, false),
  ('mov-335-rec',  'org-probe-335', 'EGRESO', 100, 'EFECTIVO', 'Alquiler',                   true,  true),
  ('mov-335-cogs', 'org-probe-335', 'EGRESO', 100, 'EFECTIVO', 'Costo de mercadería - Venta #1', false, false),
  ('mov-335-ret',  'org-probe-335', 'EGRESO', 100, 'EFECTIVO', 'Retiro de socio',            false, false),
  ('mov-335-gto',  'org-probe-335', 'EGRESO', 100, 'EFECTIVO', 'Compra de insumos',          true,  false);

-- Mismo backfill que la migracion, restringido a las filas de prueba.
UPDATE movimientos_caja SET origen = 'RECURRENTE'
 WHERE organization_id = 'org-probe-335' AND origen = 'MANUAL' AND es_recurrente = true;
UPDATE movimientos_caja SET origen = 'DEVOLUCION'
 WHERE organization_id = 'org-probe-335' AND origen = 'MANUAL' AND tipo = 'EGRESO' AND afecta_rentabilidad = false
   AND concepto ~* '^\s*devoluci[oó]n\s';
UPDATE movimientos_caja SET origen = 'NOTA_CREDITO'
 WHERE organization_id = 'org-probe-335' AND origen = 'MANUAL' AND tipo = 'EGRESO' AND afecta_rentabilidad = false
   AND concepto ~* '^\s*nota de cr[eé]dito\s';
UPDATE movimientos_caja SET origen = 'COGS'
 WHERE organization_id = 'org-probe-335' AND origen = 'MANUAL' AND tipo = 'EGRESO' AND afecta_rentabilidad = false
   AND concepto ~* '^\s*costo de mercader';

INSERT INTO _r SELECT 1, 'devolucion -> DEVOLUCION', 'DEVOLUCION', origen FROM movimientos_caja WHERE id = 'mov-335-dev';
INSERT INTO _r SELECT 2, 'nota de credito -> NOTA_CREDITO', 'NOTA_CREDITO', origen FROM movimientos_caja WHERE id = 'mov-335-nc';
INSERT INTO _r SELECT 3, 'recurrente -> RECURRENTE', 'RECURRENTE', origen FROM movimientos_caja WHERE id = 'mov-335-rec';
INSERT INTO _r SELECT 4, 'COGS -> COGS', 'COGS', origen FROM movimientos_caja WHERE id = 'mov-335-cogs';
INSERT INTO _r SELECT 5, 'retiro de socio sigue MANUAL', 'MANUAL', origen FROM movimientos_caja WHERE id = 'mov-335-ret';
INSERT INTO _r SELECT 6, 'gasto comun sigue MANUAL', 'MANUAL', origen FROM movimientos_caja WHERE id = 'mov-335-gto';

DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    UPDATE movimientos_caja SET origen = 'INVENTADO' WHERE id = 'mov-335-gto';
  EXCEPTION WHEN check_violation THEN
    v_msg := 'check_violation';
  END;
  INSERT INTO _r VALUES (7, 'el CHECK rechaza un origen desconocido', 'check_violation', v_msg);
END $$;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
