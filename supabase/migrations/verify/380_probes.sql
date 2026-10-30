-- Verification of comisiones_recepcion (migration 380): comisiones_config, reception rates and the snapshot trigger.
--
-- Run AFTER 380 is applied, in the SQL editor of Supabase Studio or with
--   node scripts/db-run.mjs supabase/migrations/verify/380_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
--
-- Without RLS, as in verify/README.md. It creates no organization: it picks a REAL organization
-- that has a sucursal, a cliente and at least two users, sets those two users' rates and the
-- organization's config INSIDE the probe, and inserts orders with a plain INSERT INTO
-- ordenes_servicio. The trigger fires for every insert path, so one insert shape proves it.
-- Everything it writes is rolled back. A probe that finds no fitting fixture skips itself
-- and says so in `obtenido` (SALTEADO: ...).
--
-- What it proves, against the real schema:
--   * propio: the receiver's own rate (7) is frozen on the order;
--   * por defecto: a receiver with NULL rate gets the organization default (3);
--   * sin config: with no comisiones_config row and no own rate, the order gets 0;
--   * sin receptor: no recibido_por gets 0;
--   * otra org: a receiver of another organization gets 0 (never that person's rate);
--   * explicito: a value given on INSERT (9) is kept;
--   * the CHECKs reject 101 on comisiones_config and on users;
--   * comisiones_config is closed to authenticated and open to service_role (has_table_privilege);
--   * the trigger function is SECURITY DEFINER (prosecdef) with a pinned search_path, and
--     authenticated cannot execute it.
--
-- Results accumulate in _r380 and come out in ONE select. Green = esperado equals obtenido,
-- or obtenido starts with 'OK:'.

BEGIN;

CREATE TEMP TABLE _r380 (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

CREATE TEMP TABLE _ctx380 (org TEXT, suc TEXT, cli TEXT, u_propio TEXT, u_defecto TEXT, u_ajeno TEXT);

-- Fixture: a real org with a sucursal, a cliente and two users; plus a user of ANOTHER org.
INSERT INTO _ctx380 (org, suc, cli, u_propio, u_defecto, u_ajeno)
SELECT o.id,
       (SELECT s.id FROM sucursales s WHERE s.organization_id = o.id ORDER BY s.id LIMIT 1),
       (SELECT c.id FROM clientes c WHERE c.organization_id = o.id ORDER BY c.id LIMIT 1),
       (SELECT u.id FROM users u WHERE u.organization_id = o.id ORDER BY u.id LIMIT 1),
       (SELECT u.id FROM users u WHERE u.organization_id = o.id ORDER BY u.id OFFSET 1 LIMIT 1),
       (SELECT u.id FROM users u WHERE u.organization_id <> o.id ORDER BY u.id LIMIT 1)
  FROM organizations o
 WHERE EXISTS (SELECT 1 FROM sucursales s WHERE s.organization_id = o.id)
   AND EXISTS (SELECT 1 FROM clientes c WHERE c.organization_id = o.id)
   AND (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) >= 2
 ORDER BY o.id
 LIMIT 1;

-- Inserts one order and returns the rate the trigger froze (or the explicit one).
CREATE FUNCTION pg_temp.ins380(p_recibido TEXT, p_pct NUMERIC) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  c _ctx380%ROWTYPE;
  v_num INTEGER;
  v_pct NUMERIC;
BEGIN
  SELECT * INTO c FROM _ctx380;
  v_num := get_next_order_number(c.org);
  INSERT INTO ordenes_servicio (numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
                                dispositivo, tipo_dispositivo, problema_reportado, recibido_por,
                                porcentaje_comision_recepcion)
  VALUES (v_num, 'P380-' || v_num, c.cli, c.org, c.suc, 'probe 380', 'otro', 'probe 380', p_recibido, p_pct)
  RETURNING porcentaje_comision_recepcion INTO v_pct;
  RETURN v_pct;
END $$;

INSERT INTO _r380 SELECT 1, 'fixture: org con sucursal, cliente y dos usuarios', 'true',
  CASE WHEN EXISTS (SELECT 1 FROM _ctx380) THEN 'true' ELSE 'SALTEADO: la base no tiene una org con sucursal, cliente y dos usuarios' END;

-- Rates and config set INSIDE the probe: the first user has 7, the second NULL, the org default is 3.
UPDATE users SET porcentaje_comision_recepcion = 7 WHERE id = (SELECT u_propio FROM _ctx380);
UPDATE users SET porcentaje_comision_recepcion = NULL WHERE id = (SELECT u_defecto FROM _ctx380);
INSERT INTO comisiones_config (organization_id, recepcion_porcentaje_default)
SELECT org, 3 FROM _ctx380
ON CONFLICT (organization_id) DO UPDATE SET recepcion_porcentaje_default = 3;

-- ── 2-3. Own rate and org default ──────────────────────────────────────────
INSERT INTO _r380 SELECT 2, 'propio: la tasa del receptor (7) queda congelada en la orden', '7.00',
  COALESCE(pg_temp.ins380((SELECT u_propio FROM _ctx380), NULL)::TEXT, 'SALTEADO: sin fixture')
  WHERE EXISTS (SELECT 1 FROM _ctx380);

INSERT INTO _r380 SELECT 3, 'por defecto: receptor sin tasa propia toma el default de la org (3)', '3.00',
  COALESCE(pg_temp.ins380((SELECT u_defecto FROM _ctx380), NULL)::TEXT, 'SALTEADO: sin fixture')
  WHERE EXISTS (SELECT 1 FROM _ctx380);

-- ── 4. Explicit value kept ─────────────────────────────────────────────────
INSERT INTO _r380 SELECT 4, 'explicito: un valor dado en el INSERT (9) se respeta', '9.00',
  COALESCE(pg_temp.ins380((SELECT u_propio FROM _ctx380), 9)::TEXT, 'SALTEADO: sin fixture')
  WHERE EXISTS (SELECT 1 FROM _ctx380);

-- ── 5. No receiver ─────────────────────────────────────────────────────────
INSERT INTO _r380 SELECT 5, 'sin receptor: recibido_por NULL congela 0', '0.00',
  COALESCE(pg_temp.ins380(NULL, NULL)::TEXT, 'SALTEADO: sin fixture')
  WHERE EXISTS (SELECT 1 FROM _ctx380);

-- ── 6. Receiver of another org ─────────────────────────────────────────────
-- The other org's user gets a rate of 50 so that using it would be visible.
UPDATE users SET porcentaje_comision_recepcion = 50 WHERE id = (SELECT u_ajeno FROM _ctx380);
INSERT INTO _r380 SELECT 6, 'otra org: un receptor de otra organizacion congela 0 (nunca su tasa)', '0.00',
  COALESCE(pg_temp.ins380((SELECT u_ajeno FROM _ctx380), NULL)::TEXT, 'SALTEADO: sin fixture')
  WHERE EXISTS (SELECT 1 FROM _ctx380 WHERE u_ajeno IS NOT NULL);
INSERT INTO _r380 SELECT 6, 'otra org: un receptor de otra organizacion congela 0 (nunca su tasa)', '0.00',
  'SALTEADO: la base no tiene usuarios de otra org'
  WHERE EXISTS (SELECT 1 FROM _ctx380 WHERE u_ajeno IS NULL);

-- ── 7. No config row ───────────────────────────────────────────────────────
DELETE FROM comisiones_config WHERE organization_id = (SELECT org FROM _ctx380);
INSERT INTO _r380 SELECT 7, 'sin config: receptor sin tasa propia y sin fila de config congela 0', '0.00',
  COALESCE(pg_temp.ins380((SELECT u_defecto FROM _ctx380), NULL)::TEXT, 'SALTEADO: sin fixture')
  WHERE EXISTS (SELECT 1 FROM _ctx380);

-- ── 8-9. CHECKs reject 101 ─────────────────────────────────────────────────
DO $$
DECLARE v_org TEXT; v_user TEXT; v_msg TEXT;
BEGIN
  SELECT org, u_propio INTO v_org, v_user FROM _ctx380;
  IF v_org IS NULL THEN
    INSERT INTO _r380 VALUES (8, 'CHECK: comisiones_config rechaza 101', '23514', 'SALTEADO: sin fixture');
    INSERT INTO _r380 VALUES (9, 'CHECK: users rechaza 101', '23514', 'SALTEADO: sin fixture');
    RETURN;
  END IF;
  BEGIN
    INSERT INTO comisiones_config (organization_id, recepcion_porcentaje_default) VALUES (v_org, 101);
    INSERT INTO _r380 VALUES (8, 'CHECK: comisiones_config rechaza 101', '23514', 'FALLO: acepto 101');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r380 VALUES (8, 'CHECK: comisiones_config rechaza 101', '23514', 'OK: ' || SQLSTATE);
  END;
  BEGIN
    UPDATE users SET porcentaje_comision_recepcion = 101 WHERE id = v_user;
    INSERT INTO _r380 VALUES (9, 'CHECK: users rechaza 101', '23514', 'FALLO: acepto 101');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r380 VALUES (9, 'CHECK: users rechaza 101', '23514', 'OK: ' || SQLSTATE);
  END;
END $$;

-- ── 10. Privileges on comisiones_config (always runs) ──────────────────────
INSERT INTO _r380 SELECT 10, 'comisiones_config: has_table_privilege authenticated SELECT / service_role SELECT',
  'false / true',
  has_table_privilege('authenticated', 'public.comisiones_config', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('service_role', 'public.comisiones_config', 'SELECT')::TEXT;

-- ── 11. Trigger function shape (always runs) ───────────────────────────────
INSERT INTO _r380 SELECT 11, 'set_porcentaje_comision_recepcion: prosecdef / search_path fijado / authenticated puede ejecutar',
  'true / true / false',
  COALESCE(bool_or(p.prosecdef)::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(array_to_string(p.proconfig, ',') LIKE '%search_path%')::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::TEXT, '-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_porcentaje_comision_recepcion';

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido OR obtenido LIKE 'OK:%' THEN 'OK'
            WHEN obtenido LIKE 'SALTEADO:%' THEN 'SALTEADO' ELSE 'FALLO' END AS resultado
  FROM _r380 ORDER BY orden, probe;

ROLLBACK;
