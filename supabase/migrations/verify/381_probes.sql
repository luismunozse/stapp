-- Verification of comisiones_reparaciones (migration 381): the order branch of v_comisiones_filas / v_comisiones_devengadas.
--
-- Run AFTER 380 and 381 are applied (or, in a dry-run, with both files before this one), with
--   node scripts/db-run.mjs supabase/migrations/verify/381_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
--
-- Without RLS, as in verify/README.md. R0 only reads real rows. Every other probe builds its
-- own order inside one real organization (two users of that organization, a sucursal, a cliente
-- and one inventory item for the part) and sets its own rates and commission rules: it never
-- relies on the live rates of any user. A probe that finds no fitting organization skips
-- itself and says so in `obtenido` (SALTEADO: ...).
--
-- Fixture order: costo_final 1000, descuento_cobro 100, one part 1 x 200, one credit note 50,
-- porcentaje_comision 10 (technician T), porcentaje_comision_recepcion 5 (receiver R), a cobro
-- of 900 so estado_cobro is COBRADO. So the order amount is 850, labour is 650, TECNICO is
-- 65.00 and RECEPCION is 42.50.
--
-- What it proves:
--   R0  every live payout item has a row in the view with the same clave, monto, pagado = true
--       and the payout's beneficiary (expected 0 mismatches), before any fixture is written;
--   R1  ENTREGADO + COBRADO: TECNICO base 650 / 65.00 / MANO_DE_OBRA / documento_monto 850,
--       RECEPCION base 850 / 42.50, both devengada;
--   R2  tecnico_base MONTO_ORDEN and recepcion_base MANO_DE_OBRA: 85.00 and 32.50;
--   R3  a second credit note of 2000: documento_monto 0, TECNICO row at 0, no RECEPCION row;
--   R4  a NULL (legacy) or 0 reception rate: no RECEPCION row, TECNICO row present;
--   R5  REPARADO + COBRADO for each orden_devengo rule, then ENTREGADO + PARCIAL;
--   R6  fecha_devengo per rule (clock_timestamp offsets), annulled cobros ignored, and an
--       order collected only through pagos_parciales dated by its last invoice payment;
--   R7  ENTREGADO_SIN_REPARACION with flag 257 off (SIN_REPARACION) and on (devengada);
--   R8  es_practica, CANCELADO, ENTREGADO_SIN_COBRO never commission; an unpaid ENTREGADO
--       order does not accrue (estado_cobro itself is NOT NULL since 067);
--   R9  es_reingreso and a reclamos_garantia row never commission, unless
--       reingreso_comisiona is on;
--   R10 paying RECEPCION leaves ordenes_servicio.comision_pagada false, paying TECNICO sets it;
--   R11 after both payouts, credit notes of 600 and then 100 (created_at = clock_timestamp())
--       give AJUSTE_DEVOLUCION rows -60.00 / -5.00 (TECNICO, capped at labour 650) and
--       -30.00 / -5.00 (RECEPCION); annulling the 100 note removes its rows;
--   R12 after the payouts, changing costo_final, descuento_cobro, both rates, tecnico_id and
--       every config rule leaves both paid rows with the same monto, beneficiary and pagado;
--   R13 annulling the RECEPCION payout makes the row live again at the current amount and leaves
--       comision_pagada unchanged (the TECNICO payout still stands);
--   R14 both views are security_invoker and closed to authenticated.
--
-- Each scenario runs in its own sub-transaction (a PL/pgSQL BEGIN ... EXCEPTION block, the
-- SAVEPOINT of a DO block) that is always rolled back by a final RAISE; its result rows travel
-- out in the exception message, because a plain ROLLBACK TO SAVEPOINT would discard them with
-- the fixture. R10 to R13 share one scenario because each builds on the previous one.
-- The two RPCs run as service_role (SET LOCAL ROLE ... RESET ROLE on both the success and the
-- exception paths), as the app calls them. Fixture setup and assertions stay as postgres.
--
-- Results accumulate in _r381 and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:'.

BEGIN;

CREATE TEMP TABLE _r381 (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

CREATE TEMP TABLE _ctx381 (
  org TEXT, t TEXT, r TEXT, admin TEXT, sucursal TEXT, cliente TEXT, inv TEXT
);

-- ── R0. Real data, read only: a live payout item is never lost or changed by the definition ──
INSERT INTO _r381
SELECT 0, 'R0: item de pago vigente sin fila igual en la vista (clave, monto, pagado, beneficiario)', '0',
       COUNT(*)::TEXT
  FROM comisiones_pagos_items i
  JOIN comisiones_pagos p ON p.id = i.pago_id
  LEFT JOIN v_comisiones_filas f
    ON f.organization_id = i.organization_id
   AND f.clave = COALESCE(i.documento_tipo, '-') || ':' || COALESCE(i.documento_id, '-') || ':' || i.rol || ':' || i.tipo || ':' || COALESCE(i.ajuste_ref, '-')
   AND f.monto = i.monto AND f.pagado AND f.beneficiario_id = p.beneficiario_id
 WHERE NOT i.anulado AND NOT p.anulado AND f.clave IS NULL;

-- ── Fixture context: one real org with two users, an admin, a sucursal, a cliente and a part ──
INSERT INTO _ctx381 (org, t, r, admin, sucursal, cliente, inv)
SELECT o.id, u.t, u.r,
       (SELECT a.id FROM users a
         WHERE a.organization_id = o.id AND a.rol = 'ADMIN' AND a.deleted_at IS NULL
         ORDER BY (a.id IN (u.t, u.r)), a.id LIMIT 1),
       (SELECT s.id FROM sucursales s WHERE s.organization_id = o.id ORDER BY s.principal DESC, s.id LIMIT 1),
       (SELECT c.id FROM clientes c WHERE c.organization_id = o.id ORDER BY c.id LIMIT 1),
       (SELECT i.id FROM inventario i ORDER BY i.id LIMIT 1)
  FROM organizations o
  CROSS JOIN LATERAL (
    SELECT (array_agg(x.id ORDER BY x.id))[1] AS t, (array_agg(x.id ORDER BY x.id))[2] AS r, COUNT(*) AS n
      FROM users x WHERE x.organization_id = o.id AND x.deleted_at IS NULL
  ) u
 WHERE u.n >= 2
   AND EXISTS (SELECT 1 FROM users a WHERE a.organization_id = o.id AND a.rol = 'ADMIN' AND a.deleted_at IS NULL)
   AND EXISTS (SELECT 1 FROM sucursales s WHERE s.organization_id = o.id)
   AND EXISTS (SELECT 1 FROM clientes c WHERE c.organization_id = o.id)
   AND EXISTS (SELECT 1 FROM inventario)
 ORDER BY o.id
 LIMIT 1;

-- ── Helpers (pg_temp) ──────────────────────────────────────────────────────────

-- One result row, wrapped in an array so that `||` appends it to the list: [[orden, probe, esperado, obtenido]].
CREATE FUNCTION pg_temp.rr(p_orden INT, p_probe TEXT, p_esperado TEXT, p_obtenido TEXT) RETURNS JSONB
LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_array(p_orden, p_probe, p_esperado, p_obtenido)) $$;

CREATE FUNCTION pg_temp.flush(p_rows JSONB) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO _r381 SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(p_rows) AS t(r)
$$;

-- A scenario that raised: keep the rows it had, add the failure, mark the unreached probes.
CREATE FUNCTION pg_temp.flush_fail(p_rows JSONB, p_stage INT, p_last INT, p_state TEXT, p_msg TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.flush(p_rows);
  INSERT INTO _r381 VALUES (p_stage, 'R' || p_stage || ': el escenario fallo', 'OK', 'FALLO: ' || p_state || ' ' || p_msg);
  INSERT INTO _r381
  SELECT g, 'R' || g || ': escenario interrumpido', 'OK', 'SALTEADO: se interrumpio en R' || p_stage
    FROM generate_series(p_stage + 1, p_last) AS g;
END $$;

CREATE FUNCTION pg_temp.skip(p_first INT, p_last INT, p_motivo TEXT) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO _r381 SELECT g, 'R' || g || ': escenario sobre una orden armada', 'OK', 'SALTEADO: ' || p_motivo
    FROM generate_series(p_first, p_last) AS g
$$;

-- The shop's rules for the fixture organization (the defaults of 380 unless told otherwise).
CREATE FUNCTION pg_temp.cfg(p_devengo TEXT DEFAULT 'ENTREGA_Y_COBRO', p_tbase TEXT DEFAULT 'MANO_DE_OBRA',
                            p_rbase TEXT DEFAULT 'MONTO_ORDEN', p_reing BOOLEAN DEFAULT false) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO comisiones_config (organization_id, orden_devengo, tecnico_base, recepcion_base, reingreso_comisiona)
  SELECT org, p_devengo, p_tbase, p_rbase, p_reing FROM _ctx381
  ON CONFLICT (organization_id) DO UPDATE
    SET orden_devengo = EXCLUDED.orden_devengo, tecnico_base = EXCLUDED.tecnico_base,
        recepcion_base = EXCLUDED.recepcion_base, reingreso_comisiona = EXCLUDED.reingreso_comisiona,
        recepcion_porcentaje_default = 0;
END $$;

-- The fixture order: 1000, discount 100, one part 1 x 200, one credit note 50, rates 10 / 5,
-- cobro of 900 (recalcular_estado_cobro makes it COBRADO, as verify/360 does).
CREATE FUNCTION pg_temp.mk(p_estado TEXT DEFAULT 'ENTREGADO') RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  c RECORD;
  v_id TEXT := 'ord-p381-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
BEGIN
  SELECT * INTO c FROM _ctx381;
  INSERT INTO ordenes_servicio (
    id, numero_orden, cliente_id, organization_id, sucursal_id,
    dispositivo, tipo_dispositivo, problema_reportado, estado,
    costo_final, descuento_cobro, tecnico_id, recibido_por,
    porcentaje_comision, porcentaje_comision_recepcion,
    fecha_entrega, total_cobrado, estado_cobro
  ) VALUES (
    v_id, (SELECT COALESCE(MAX(x.numero_orden), 0) + 1 FROM ordenes_servicio x WHERE x.organization_id = c.org),
    c.cliente, c.org, c.sucursal,
    'Celular', 'CELULAR', 'Probe 381', p_estado::estado_orden,
    1000, 100, c.t, c.r,
    10, 5,
    now() - interval '2 days', 0, 'PENDIENTE'
  );
  INSERT INTO repuestos_orden (orden_id, inventario_id, cantidad, precio_unitario) VALUES (v_id, c.inv, 1, 200);
  INSERT INTO notas_credito (organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda, created_at)
  VALUES (c.org, 'NC-P381-' || substr(md5(random()::text), 1, 10), v_id, 'AJUSTE_PRECIO', 50, 0, now() - interval '3 days');
  INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago, created_at)
  VALUES (v_id, c.org, 900, 'EFECTIVO', now() - interval '1 day');
  PERFORM recalcular_estado_cobro(v_id);
  RETURN v_id;
END $$;

-- A live ORIGINAL row as text: base|monto|state|base_tipo|documento_monto.
CREATE FUNCTION pg_temp.fx(p_id TEXT, p_rol TEXT, p_tipo TEXT DEFAULT 'ORIGINAL') RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(format('%s|%s|%s|%s|%s', f.base, f.monto,
           CASE WHEN f.devengada THEN 'devengada' ELSE f.motivo_sin_devengo END,
           COALESCE(f.base_tipo, '-'), COALESCE(f.documento_monto::TEXT, '-')), ' ; ' ORDER BY f.clave), 'sin fila')
    FROM v_comisiones_filas f
   WHERE f.documento_tipo = 'ORDEN' AND f.documento_id = p_id AND f.rol = p_rol AND f.tipo = p_tipo
$$;

-- Accrual state of the ORIGINAL row of one role.
CREATE FUNCTION pg_temp.est(p_id TEXT, p_rol TEXT) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(CASE WHEN f.devengada THEN 'devengada' ELSE f.motivo_sin_devengo END, ' ; '), 'sin fila')
    FROM v_comisiones_filas f
   WHERE f.documento_tipo = 'ORDEN' AND f.documento_id = p_id AND f.rol = p_rol AND f.tipo = 'ORIGINAL'
$$;

CREATE FUNCTION pg_temp.est2(p_id TEXT) RETURNS TEXT
LANGUAGE sql AS $$ SELECT pg_temp.est(p_id, 'TECNICO') || ' / ' || pg_temp.est(p_id, 'RECEPCION') $$;

-- fecha_devengo of both ORIGINAL rows equals p_ts: 'true / true' (TECNICO, RECEPCION).
CREATE FUNCTION pg_temp.fd_ok(p_id TEXT, p_ts TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT string_agg(COALESCE((f.fecha_devengo = p_ts)::TEXT, 'null'), ' / ' ORDER BY f.rol DESC)
    FROM v_comisiones_filas f
   WHERE f.documento_tipo = 'ORDEN' AND f.documento_id = p_id AND f.tipo = 'ORIGINAL' AND f.rol IN ('TECNICO', 'RECEPCION')
$$;

-- The credit-note adjustment amounts of one role, oldest first.
CREATE FUNCTION pg_temp.aj(p_id TEXT, p_rol TEXT) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(f.monto::TEXT, ',' ORDER BY f.fecha_devengo, f.ajuste_ref), 'sin ajustes')
    FROM v_comisiones_filas f
   WHERE f.documento_tipo = 'ORDEN' AND f.documento_id = p_id AND f.rol = p_rol AND f.tipo = 'AJUSTE_DEVOLUCION'
$$;

-- Both ORIGINAL rows as clave|monto|beneficiario|pagado.
CREATE FUNCTION pg_temp.snap(p_id TEXT) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(format('%s|%s|%s|%s', f.clave, f.monto, f.beneficiario_id, f.pagado::TEXT), ' ; ' ORDER BY f.clave), 'sin filas')
    FROM v_comisiones_filas f
   WHERE f.documento_tipo = 'ORDEN' AND f.documento_id = p_id AND f.tipo = 'ORIGINAL' AND f.rol IN ('TECNICO', 'RECEPCION')
$$;

-- Pays the accrued, unpaid ORIGINAL row of one role through the real RPC, as the admin, as service_role.
CREATE FUNCTION pg_temp.pagar(p_id TEXT, p_rol TEXT, p_benef TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE c RECORD; f RECORD; v_res JSONB;
BEGIN
  SELECT * INTO c FROM _ctx381;
  SELECT x.clave, x.monto INTO f FROM v_comisiones_filas x
   WHERE x.documento_tipo = 'ORDEN' AND x.documento_id = p_id AND x.rol = p_rol AND x.tipo = 'ORIGINAL'
     AND x.devengada AND NOT x.pagado;
  BEGIN
    SET LOCAL ROLE service_role;
    v_res := pagar_comisiones(c.org, c.admin, p_benef, jsonb_build_array(jsonb_build_object('clave', f.clave, 'monto', f.monto)), 'probe 381');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;
  RETURN v_res;
END $$;

-- Annuls a payout through the real RPC, as the admin, as service_role.
CREATE FUNCTION pg_temp.anular(p_pago TEXT, p_motivo TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE c RECORD; v_res JSONB;
BEGIN
  SELECT * INTO c FROM _ctx381;
  BEGIN
    SET LOCAL ROLE service_role;
    v_res := anular_pago_comisiones(c.org, c.admin, p_pago, p_motivo);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;
  RETURN v_res;
END $$;

-- ── R1 to R4. Defaults, bases, a credit note that eats the order, no reception rate ──
DO $$
DECLARE c RECORD; v_id TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 1; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(1, 4, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    PERFORM pg_temp.cfg();
    v_id := pg_temp.mk('ENTREGADO');

    v_rows := v_rows || pg_temp.rr(1, 'R1: precondicion, la orden esta COBRADA', 'COBRADO',
      (SELECT o.estado_cobro FROM ordenes_servicio o WHERE o.id = v_id));
    v_rows := v_rows || pg_temp.rr(1, 'R1: TECNICO base|monto|estado|base_tipo|documento_monto', '650.00|65.00|devengada|MANO_DE_OBRA|850.00', pg_temp.fx(v_id, 'TECNICO'));
    v_rows := v_rows || pg_temp.rr(1, 'R1: RECEPCION base|monto|estado|base_tipo|documento_monto', '850.00|42.50|devengada|MONTO_ORDEN|850.00', pg_temp.fx(v_id, 'RECEPCION'));

    v_stage := 2;
    PERFORM pg_temp.cfg('ENTREGA_Y_COBRO', 'MONTO_ORDEN', 'MANO_DE_OBRA');
    v_rows := v_rows || pg_temp.rr(2, 'R2: tecnico_base MONTO_ORDEN, TECNICO', '850.00|85.00|devengada|MONTO_ORDEN|850.00', pg_temp.fx(v_id, 'TECNICO'));
    v_rows := v_rows || pg_temp.rr(2, 'R2: recepcion_base MANO_DE_OBRA, RECEPCION', '650.00|32.50|devengada|MANO_DE_OBRA|850.00', pg_temp.fx(v_id, 'RECEPCION'));
    PERFORM pg_temp.cfg();

    v_stage := 4;
    UPDATE ordenes_servicio SET porcentaje_comision_recepcion = NULL WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(4, 'R4: tasa de recepcion NULL (legacy): RECEPCION', 'sin fila', pg_temp.fx(v_id, 'RECEPCION'));
    v_rows := v_rows || pg_temp.rr(4, 'R4: tasa de recepcion NULL (legacy): TECNICO sigue', '650.00|65.00|devengada|MANO_DE_OBRA|850.00', pg_temp.fx(v_id, 'TECNICO'));
    UPDATE ordenes_servicio SET porcentaje_comision_recepcion = 0 WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(4, 'R4: tasa de recepcion 0: RECEPCION', 'sin fila', pg_temp.fx(v_id, 'RECEPCION'));
    v_rows := v_rows || pg_temp.rr(4, 'R4: tasa de recepcion 0: TECNICO sigue', '650.00|65.00|devengada|MANO_DE_OBRA|850.00', pg_temp.fx(v_id, 'TECNICO'));
    UPDATE ordenes_servicio SET porcentaje_comision_recepcion = 5 WHERE id = v_id;

    v_stage := 3;
    INSERT INTO notas_credito (organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda, created_at)
    VALUES (c.org, 'NC-P381-' || substr(md5(random()::text), 1, 10), v_id, 'AJUSTE_PRECIO', 2000, 0, now() - interval '2 days');
    v_rows := v_rows || pg_temp.rr(3, 'R3: nota de credito de 2000: TECNICO queda en 0', '0.00|0.00|devengada|MANO_DE_OBRA|0.00', pg_temp.fx(v_id, 'TECNICO'));
    v_rows := v_rows || pg_temp.rr(3, 'R3: nota de credito de 2000: sin fila RECEPCION', 'sin fila', pg_temp.fx(v_id, 'RECEPCION'));

    RAISE EXCEPTION 'rollback del escenario R1-R4' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 4, SQLSTATE, v_msg);
  END;
END $$;

-- ── R5. orden_devengo against the order state ──
DO $$
DECLARE c RECORD; v_id TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 5; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(5, 5, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    v_id := pg_temp.mk('REPARADO');

    PERFORM pg_temp.cfg('ENTREGA_Y_COBRO');
    v_rows := v_rows || pg_temp.rr(5, 'R5: REPARADO + COBRADO, ENTREGA_Y_COBRO (TECNICO / RECEPCION)', 'ESPERA_ENTREGA_Y_COBRO / ESPERA_ENTREGA_Y_COBRO', pg_temp.est2(v_id));
    PERFORM pg_temp.cfg('COBRO');
    v_rows := v_rows || pg_temp.rr(5, 'R5: REPARADO + COBRADO, COBRO', 'devengada / devengada', pg_temp.est2(v_id));
    PERFORM pg_temp.cfg('ENTREGA');
    v_rows := v_rows || pg_temp.rr(5, 'R5: REPARADO + COBRADO, ENTREGA', 'ESPERA_ENTREGA / ESPERA_ENTREGA', pg_temp.est2(v_id));

    UPDATE ordenes_servicio SET estado = 'ENTREGADO', estado_cobro = 'PARCIAL' WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(5, 'R5: ENTREGADO + PARCIAL, ENTREGA', 'devengada / devengada', pg_temp.est2(v_id));
    PERFORM pg_temp.cfg('ENTREGA_Y_COBRO');
    v_rows := v_rows || pg_temp.rr(5, 'R5: ENTREGADO + PARCIAL, ENTREGA_Y_COBRO', 'ESPERA_ENTREGA_Y_COBRO / ESPERA_ENTREGA_Y_COBRO', pg_temp.est2(v_id));
    PERFORM pg_temp.cfg('COBRO');
    v_rows := v_rows || pg_temp.rr(5, 'R5: ENTREGADO + PARCIAL, COBRO', 'ESPERA_COBRO / ESPERA_COBRO', pg_temp.est2(v_id));

    RAISE EXCEPTION 'rollback del escenario R5' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 5, SQLSTATE, v_msg);
  END;
END $$;

-- ── R6. fecha_devengo per rule; annulled cobros ignored; invoice payments only ──
DO $$
DECLARE c RECORD; v_id TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 6; v_msg TEXT; v0 TIMESTAMPTZ;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(6, 6, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    v0 := clock_timestamp();
    v_id := pg_temp.mk('ENTREGADO');
    UPDATE ordenes_servicio SET fecha_entrega = v0 - interval '5 days' WHERE id = v_id;
    UPDATE cobros_orden SET created_at = v0 - interval '3 days' WHERE orden_id = v_id;
    -- a later cobro that was annulled: it must not move the date
    INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago, created_at, anulado, anulado_at, anulado_por, anulado_motivo)
    VALUES (v_id, c.org, 10, 'EFECTIVO', v0 - interval '1 day', true, v0, c.admin, 'probe 381');

    PERFORM pg_temp.cfg('ENTREGA_Y_COBRO');
    v_rows := v_rows || pg_temp.rr(6, 'R6: ENTREGA_Y_COBRO, cobro (-3d) despues de la entrega (-5d)', 'true / true', pg_temp.fd_ok(v_id, v0 - interval '3 days'));
    UPDATE ordenes_servicio SET fecha_entrega = v0 - interval '2 days' WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(6, 'R6: ENTREGA_Y_COBRO, entrega (-2d) despues del cobro (-3d)', 'true / true', pg_temp.fd_ok(v_id, v0 - interval '2 days'));
    PERFORM pg_temp.cfg('ENTREGA');
    v_rows := v_rows || pg_temp.rr(6, 'R6: ENTREGA, fecha_entrega', 'true / true', pg_temp.fd_ok(v_id, v0 - interval '2 days'));
    PERFORM pg_temp.cfg('COBRO');
    v_rows := v_rows || pg_temp.rr(6, 'R6: COBRO, ultimo cobro no anulado (el anulado de -1d no cuenta)', 'true / true', pg_temp.fd_ok(v_id, v0 - interval '3 days'));

    -- only an invoice payment: the cobros are annulled, the date is the pagos_parciales.fecha
    UPDATE cobros_orden SET anulado = true, anulado_at = v0, anulado_por = c.admin, anulado_motivo = 'probe 381'
     WHERE orden_id = v_id AND NOT anulado;
    INSERT INTO facturas (id, orden_id, numero_factura, subtotal, iva, total, organization_id)
    VALUES ('fac-p381-' || substr(md5(v_id), 1, 10), v_id, 'FAC-P381-' || substr(md5(v_id), 1, 8), 900, 0, 900, c.org);
    INSERT INTO pagos_parciales (id, factura_id, monto, metodo_pago, fecha)
    VALUES ('pag-p381-' || substr(md5(v_id), 1, 10), 'fac-p381-' || substr(md5(v_id), 1, 10), 900, 'EFECTIVO', v0 - interval '4 days');
    UPDATE ordenes_servicio SET estado_cobro = 'COBRADO' WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(6, 'R6: COBRO con solo un pago de factura (pagos_parciales.fecha -4d)', 'true / true', pg_temp.fd_ok(v_id, v0 - interval '4 days'));

    RAISE EXCEPTION 'rollback del escenario R6' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 6, SQLSTATE, v_msg);
  END;
END $$;

-- ── R7. ENTREGADO_SIN_REPARACION and flag 257 ──
DO $$
DECLARE c RECORD; v_id TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 7; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(7, 7, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    PERFORM pg_temp.cfg();
    v_id := pg_temp.mk('ENTREGADO_SIN_REPARACION');

    UPDATE organizations SET comision_aplica_sin_reparacion = false WHERE id = c.org;
    v_rows := v_rows || pg_temp.rr(7, 'R7: ENTREGADO_SIN_REPARACION, flag 257 apagado (TECNICO / RECEPCION)', 'SIN_REPARACION / SIN_REPARACION', pg_temp.est2(v_id));
    UPDATE organizations SET comision_aplica_sin_reparacion = true WHERE id = c.org;
    v_rows := v_rows || pg_temp.rr(7, 'R7: ENTREGADO_SIN_REPARACION, flag 257 prendido', 'devengada / devengada', pg_temp.est2(v_id));

    RAISE EXCEPTION 'rollback del escenario R7' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 7, SQLSTATE, v_msg);
  END;
END $$;

-- ── R8. Orders that never commission, and an unpaid delivered one ──
DO $$
DECLARE c RECORD; v_id TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 8; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(8, 8, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    PERFORM pg_temp.cfg();
    v_id := pg_temp.mk('ENTREGADO');

    UPDATE ordenes_servicio SET es_practica = true WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(8, 'R8: es_practica (TECNICO / RECEPCION)', 'NO_COMISIONA / NO_COMISIONA', pg_temp.est2(v_id));
    UPDATE ordenes_servicio SET es_practica = false, estado = 'CANCELADO' WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(8, 'R8: CANCELADO', 'NO_COMISIONA / NO_COMISIONA', pg_temp.est2(v_id));
    UPDATE ordenes_servicio SET estado = 'ENTREGADO_SIN_COBRO' WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(8, 'R8: ENTREGADO_SIN_COBRO', 'NO_COMISIONA / NO_COMISIONA', pg_temp.est2(v_id));
    UPDATE ordenes_servicio SET estado = 'ENTREGADO', estado_cobro = 'PENDIENTE' WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(8, 'R8: ENTREGADO sin cobrar (estado_cobro PENDIENTE) no devenga', 'ESPERA_ENTREGA_Y_COBRO / ESPERA_ENTREGA_Y_COBRO', pg_temp.est2(v_id));

    -- estado_cobro is NOT NULL since 067: the NULL case cannot exist, and must not be reachable.
    BEGIN
      UPDATE ordenes_servicio SET estado_cobro = NULL WHERE id = v_id;
      v_rows := v_rows || pg_temp.rr(8, 'R8: estado_cobro NULL con ENTREGADO no devenga', 'ESPERA_ENTREGA_Y_COBRO / ESPERA_ENTREGA_Y_COBRO', pg_temp.est2(v_id));
    EXCEPTION WHEN not_null_violation THEN
      v_rows := v_rows || pg_temp.rr(8, 'R8: estado_cobro NULL con ENTREGADO no devenga', 'OK', 'OK: estado_cobro es NOT NULL (067), el caso NULL no existe');
    END;

    RAISE EXCEPTION 'rollback del escenario R8' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 8, SQLSTATE, v_msg);
  END;
END $$;

-- ── R9. Warranty re-entries ──
DO $$
DECLARE c RECORD; v_id TEXT; v_g TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 9; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(9, 9, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    PERFORM pg_temp.cfg();
    v_id := pg_temp.mk('ENTREGADO');

    UPDATE ordenes_servicio SET es_reingreso = true WHERE id = v_id;
    v_rows := v_rows || pg_temp.rr(9, 'R9: es_reingreso (TECNICO / RECEPCION)', 'NO_COMISIONA / NO_COMISIONA', pg_temp.est2(v_id));
    PERFORM pg_temp.cfg('ENTREGA_Y_COBRO', 'MANO_DE_OBRA', 'MONTO_ORDEN', true);
    v_rows := v_rows || pg_temp.rr(9, 'R9: es_reingreso con reingreso_comisiona', 'devengada / devengada', pg_temp.est2(v_id));
    UPDATE ordenes_servicio SET es_reingreso = false WHERE id = v_id;
    PERFORM pg_temp.cfg();

    INSERT INTO garantias (orden_id, fecha_vencimiento) VALUES (v_id, now() + interval '30 days') RETURNING id INTO v_g;
    INSERT INTO reclamos_garantia (garantia_id, descripcion, orden_reparacion_id) VALUES (v_g, 'probe 381', v_id);
    v_rows := v_rows || pg_temp.rr(9, 'R9: orden apuntada por un reclamos_garantia', 'NO_COMISIONA / NO_COMISIONA', pg_temp.est2(v_id));
    PERFORM pg_temp.cfg('ENTREGA_Y_COBRO', 'MANO_DE_OBRA', 'MONTO_ORDEN', true);
    v_rows := v_rows || pg_temp.rr(9, 'R9: reclamos_garantia con reingreso_comisiona', 'devengada / devengada', pg_temp.est2(v_id));

    RAISE EXCEPTION 'rollback del escenario R9' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 9, SQLSTATE, v_msg);
  END;
END $$;

-- ── R10 to R13. Payouts, credit notes after the payout, frozen paid rows, annulled payout ──
DO $$
DECLARE
  c RECORD; v_id TEXT; v_rows JSONB := '[]'::jsonb; v_stage INT := 10; v_msg TEXT;
  v_pr JSONB; v_pt JSONB; v_nc1 TEXT; v_nc2 TEXT; v_antes TEXT;
BEGIN
  SELECT * INTO c FROM _ctx381;
  IF NOT FOUND THEN PERFORM pg_temp.skip(10, 13, 'la base no tiene una org con dos usuarios, admin, sucursal, cliente e inventario'); RETURN; END IF;
  BEGIN
    PERFORM pg_temp.cfg();
    v_id := pg_temp.mk('ENTREGADO');

    -- R10: the RECEPCION payout does not touch comision_pagada; the TECNICO one does
    v_pr := pg_temp.pagar(v_id, 'RECEPCION', c.r);
    v_rows := v_rows || pg_temp.rr(10, 'R10: pago RECEPCION: rol del item / total 42.50 / comision_pagada', 'RECEPCION / true / false',
      (SELECT string_agg(i.rol, ',') FROM comisiones_pagos_items i WHERE i.pago_id = v_pr->>'pagoId' AND NOT i.anulado)
      || ' / ' || ((v_pr->>'total')::NUMERIC = 42.50)::TEXT
      || ' / ' || (SELECT COALESCE(o.comision_pagada, false)::TEXT FROM ordenes_servicio o WHERE o.id = v_id));
    v_pt := pg_temp.pagar(v_id, 'TECNICO', c.t);
    v_rows := v_rows || pg_temp.rr(10, 'R10: pago TECNICO: rol del item / total 65.00 / comision_pagada', 'TECNICO / true / true',
      (SELECT string_agg(i.rol, ',') FROM comisiones_pagos_items i WHERE i.pago_id = v_pt->>'pagoId' AND NOT i.anulado)
      || ' / ' || ((v_pt->>'total')::NUMERIC = 65.00)::TEXT
      || ' / ' || (SELECT COALESCE(o.comision_pagada, false)::TEXT FROM ordenes_servicio o WHERE o.id = v_id));

    -- R11: credit notes after the payouts (now() is frozen in the transaction: clock_timestamp())
    v_stage := 11;
    INSERT INTO notas_credito (organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda, created_at)
    VALUES (c.org, 'NC-P381-' || substr(md5(random()::text), 1, 10), v_id, 'AJUSTE_PRECIO', 600, 0, clock_timestamp())
    RETURNING id INTO v_nc1;
    INSERT INTO notas_credito (organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda, created_at)
    VALUES (c.org, 'NC-P381-' || substr(md5(random()::text), 1, 10), v_id, 'AJUSTE_PRECIO', 100, 0, clock_timestamp())
    RETURNING id INTO v_nc2;
    v_rows := v_rows || pg_temp.rr(11, 'R11: ajustes AJUSTE_DEVOLUCION TECNICO (600 y 100, tope en la mano de obra 650)', '-60.00,-5.00', pg_temp.aj(v_id, 'TECNICO'));
    v_rows := v_rows || pg_temp.rr(11, 'R11: ajustes AJUSTE_DEVOLUCION RECEPCION (600 y 100)', '-30.00,-5.00', pg_temp.aj(v_id, 'RECEPCION'));
    UPDATE notas_credito SET anulada = true, anulada_at = clock_timestamp(), anulada_por = c.admin, anulada_motivo = 'probe 381' WHERE id = v_nc2;
    v_rows := v_rows || pg_temp.rr(11, 'R11: nota de 100 anulada, ajustes TECNICO / RECEPCION', '-60.00 / -30.00',
      pg_temp.aj(v_id, 'TECNICO') || ' / ' || pg_temp.aj(v_id, 'RECEPCION'));
    v_rows := v_rows || pg_temp.rr(11, 'R11: nota de 100 anulada, filas que quedan con su ajuste_ref', '0',
      (SELECT COUNT(*)::TEXT FROM v_comisiones_filas f WHERE f.documento_id = v_id AND f.ajuste_ref = v_nc2));

    -- R12: nothing that changes after the payouts moves a paid row
    v_stage := 12;
    v_antes := pg_temp.snap(v_id);
    v_rows := v_rows || pg_temp.rr(12, 'R12: precondicion, las dos filas ORIGINAL estan pagadas', 'true / true',
      (SELECT COUNT(*) = 2 FROM v_comisiones_filas f WHERE f.documento_id = v_id AND f.tipo = 'ORIGINAL' AND f.pagado)::TEXT
      || ' / ' || (v_antes LIKE '%:TECNICO:ORIGINAL:-|65.00|' || c.t || '|true%' AND v_antes LIKE '%:RECEPCION:ORIGINAL:-|42.50|' || c.r || '|true%')::TEXT);
    UPDATE ordenes_servicio SET tecnico_id = c.r WHERE id = v_id;
    UPDATE ordenes_servicio SET porcentaje_comision = 20, porcentaje_comision_recepcion = 10,
                                costo_final = 2000, descuento_cobro = 0 WHERE id = v_id;
    PERFORM pg_temp.cfg('COBRO', 'MONTO_ORDEN', 'MANO_DE_OBRA', true);
    v_rows := v_rows || pg_temp.rr(12, 'R12: filas pagadas (clave|monto|beneficiario|pagado) tras cambiar costo, descuento, tasas, tecnico y reglas', v_antes, pg_temp.snap(v_id));

    -- R13: annulling the RECEPCION payout brings the row back live at the current amount
    v_stage := 13;
    PERFORM pg_temp.anular(v_pr->>'pagoId', 'probe 381 R13');
    v_rows := v_rows || pg_temp.rr(13, 'R13: fila RECEPCION tras anular su pago: pagado / monto actual (1350 - 200 = 1150, 10%) / comision_pagada', 'pagado=false / monto=115.00 / flag=true',
      (SELECT format('pagado=%s / monto=%s / flag=%s', f.pagado::TEXT, f.monto, COALESCE(o.comision_pagada, false)::TEXT)
         FROM v_comisiones_filas f JOIN ordenes_servicio o ON o.id = f.documento_id
        WHERE f.documento_id = v_id AND f.rol = 'RECEPCION' AND f.tipo = 'ORIGINAL'));
    v_rows := v_rows || pg_temp.rr(13, 'R13: la fila TECNICO sigue pagada con su monto', 'true|65.00',
      (SELECT f.pagado::TEXT || '|' || f.monto::TEXT FROM v_comisiones_filas f WHERE f.documento_id = v_id AND f.rol = 'TECNICO' AND f.tipo = 'ORIGINAL'));

    RAISE EXCEPTION 'rollback del escenario R10-R13' USING ERRCODE = 'P0381';
  EXCEPTION
    WHEN SQLSTATE 'P0381' THEN PERFORM pg_temp.flush(v_rows);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      PERFORM pg_temp.flush_fail(v_rows, v_stage, 13, SQLSTATE, v_msg);
  END;
END $$;

-- ── R14. Privileges (always runs) ──
INSERT INTO _r381 SELECT 14, 'R14: security_invoker filas / devengadas, authenticated puede leer filas / devengadas',
  'true / true / false / false',
  COALESCE((SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c WHERE c.oid = 'public.v_comisiones_filas'::regclass), false)::TEXT || ' / ' ||
  COALESCE((SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c WHERE c.oid = 'public.v_comisiones_devengadas'::regclass), false)::TEXT || ' / ' ||
  has_table_privilege('authenticated', 'v_comisiones_filas', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('authenticated', 'v_comisiones_devengadas', 'SELECT')::TEXT;

-- No probe lost its row: R0 to R14 each left at least one.
INSERT INTO _r381 SELECT 99, 'probes R0 a R14 con al menos una fila', '15',
  COUNT(DISTINCT orden)::TEXT FROM _r381 WHERE orden BETWEEN 0 AND 14;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido OR obtenido LIKE 'OK:%' THEN 'OK'
            WHEN obtenido LIKE 'SALTEADO:%' THEN 'SALTEADO' ELSE 'FALLA' END AS resultado
  FROM _r381 ORDER BY orden, probe;

ROLLBACK;
