-- Migration 356: numeracion NC- compartida y vista unificada.
--
-- Spec: docs/superpowers/specs/2026-10-07-notas-de-credito-design.md
-- Plan: docs/superpowers/plans/2026-10-07-notas-credito-pr1-bases.md (PR1c)
-- Requiere la 350 (columnas modo, motivo_nc, anulada, monto_aplicado_deuda).
--
-- 1. registrar_devolucion_atomica asigna el numero NC- ADENTRO de su
--    transaccion, con el mismo contador que las NC de ordenes
--    (get_next_nota_credito_number, 186). Antes la ruta pedia un DEV- antes de
--    llamar y, si la RPC fallaba, el numero se quemaba.
--
--    El cuerpo vigente (330) no se toca: se renombra a registrar_devolucion_nucleo
--    y registrar_devolucion_atomica pasa a ser un envoltorio con la MISMA firma.
--    Asi se conserva todo lo que el cuerpo ya hace (saldo pendiente,
--    idempotencia, retiro de garantia y series) sin copiarlo. Sin sobrecarga
--    nueva PostgREST no ve dos candidatas (lo que obligo a la 330 a borrar la
--    vieja), y el codigo anterior sigue andando mientras se despliega el nuevo:
--    si manda p_numero_devolucion (DEV-) se respeta.
--
--    Los numeros ya asignados (DEV- en devoluciones_venta, NC- en notas_credito)
--    no se reescriben: esta migracion no hace ningun UPDATE.
--
--    Carrera entre emisiones: get_next_nota_credito_number es un
--    INSERT ... ON CONFLICT DO UPDATE sobre la fila del contador de la org. Esa
--    fila queda bloqueada hasta el commit, asi que dos emisiones concurrentes se
--    serializan y nunca reciben el mismo numero. Si la devolucion falla, el
--    rollback devuelve el contador: no quedan huecos.
--
-- 2. v_notas_credito: una sola lista de notas de credito sobre los dos motores.
--    Creada con security_invoker y SIN acceso para anon ni authenticated: en
--    Supabase una vista nueva de postgres recibe grants por default y salta el
--    RLS (ver la 347). La app la lee con service_role.
--
-- Sin foreign keys nuevas: borrar una organizacion no cambia.
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion y por
-- default la revierte. Un BEGIN aca haria que `npm run db:dry` lo ejecute tal
-- cual y lo COMMITEE.

-- ── 1. Numeracion dentro de la transaccion ─────────────────────────────────
ALTER FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  RENAME TO registrar_devolucion_nucleo;

-- El nucleo acepta cualquier numero y cualquier organizacion: solo lo llama el
-- envoltorio. Sin acceso directo para anon ni authenticated (la app usa
-- service_role).
REVOKE EXECUTE ON FUNCTION public.registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

CREATE FUNCTION public.registrar_devolucion_atomica(
  p_org_id               TEXT,
  p_venta_id             TEXT,
  p_user_id              TEXT,
  p_numero_devolucion    TEXT,
  p_motivo               TEXT,
  p_observaciones        TEXT,
  p_metodo_reembolso     TEXT,
  p_reembolso_referencia TEXT,
  p_items                JSONB,
  p_idempotency_key      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_numero TEXT;
  v_res    JSONB;
BEGIN
  -- El mismo lock que el nucleo toma en su paso 1, tomado antes: un reintento
  -- concurrente con la misma clave espera aca a que el primero commitee, ve su
  -- devolucion y no pide numero.
  PERFORM 1 FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT numero_devolucion INTO v_numero
    FROM devoluciones_venta
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  -- Reintento: el numero de la devolucion ya creada (el nucleo devuelve esa).
  -- Llamada nueva: el que mande el codigo anterior a esta migracion (DEV-) o el
  -- NC- siguiente. Si el nucleo falla, vuelve atras toda la transaccion,
  -- contador incluido: el numero no se quema.
  IF v_numero IS NULL THEN
    v_numero := COALESCE(NULLIF(p_numero_devolucion, ''), get_next_nota_credito_number(p_org_id));
  END IF;

  v_res := registrar_devolucion_nucleo(
    p_org_id, p_venta_id, p_user_id, v_numero, p_motivo, p_observaciones,
    p_metodo_reembolso, p_reembolso_referencia, p_items, p_idempotency_key
  );

  RETURN v_res || jsonb_build_object('numero', v_numero);
END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) IS
  'Devolucion de venta (nota de credito del motor de ventas). Asigna el numero NC- '
  'adentro de la transaccion con el contador compartido (get_next_nota_credito_number) '
  'salvo que reciba uno (codigo anterior a la 356) y delega en registrar_devolucion_nucleo '
  '(cuerpo de la 330). Devuelve lo mismo que la 330 mas numero. Migracion 356.';

-- Mismo acceso que el nucleo: la unica que la llama es la ruta de devolucion,
-- con service_role. Sin esto anon/authenticated llegaban hasta el nucleo (que
-- los rechaza) despues de tomar el lock de la venta.
REVOKE EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

-- ── 2. Vista unificada ─────────────────────────────────────────────────────
CREATE VIEW v_notas_credito
WITH (security_invoker = true) AS
SELECT
  dv.id,
  'VENTA'::TEXT                                                    AS origen,
  dv.venta_id                                                      AS origen_id,
  v.numero_venta::TEXT                                             AS origen_numero,
  dv.numero_devolucion                                             AS numero,
  dv.created_at                                                    AS fecha,
  dv.modo,
  dv.motivo_nc,
  dv.motivo                                                        AS detalle,
  dv.monto_devolucion::DECIMAL(12,2)                               AS monto,
  dv.monto_aplicado_deuda,
  (dv.monto_devolucion - dv.monto_aplicado_deuda)::DECIMAL(12,2)   AS monto_reembolso,
  dv.metodo_reembolso::TEXT                                        AS metodo,
  v.cliente_id,
  v.sucursal_id,
  dv.organization_id,
  dv.procesado_por                                                 AS user_id,
  dv.anulada
FROM devoluciones_venta dv
JOIN ventas v ON v.id = dv.venta_id
UNION ALL
SELECT
  nc.id,
  'ORDEN'::TEXT,
  nc.orden_id,
  COALESCE(o.codigo_orden, o.numero_orden::TEXT),
  nc.numero,
  nc.fecha,
  nc.modo,
  nc.motivo,
  nc.notas,
  nc.monto,
  nc.monto_aplicado_deuda,
  nc.monto_reembolso,
  nc.metodo_devolucion,
  o.cliente_id,
  COALESCE(nc.sucursal_id, o.sucursal_id),
  nc.organization_id,
  nc.user_id,
  nc.anulada
FROM notas_credito nc
JOIN ordenes_servicio o ON o.id = nc.orden_id;

-- Permisos: ACL final = postgres + service_role. Mismo criterio que la 347.
REVOKE ALL ON public.v_notas_credito FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_notas_credito TO service_role;

COMMENT ON VIEW v_notas_credito IS
  'Notas de credito de los dos motores (devoluciones_venta y notas_credito) con columnas '
  'normalizadas. Hereda RLS (security_invoker); solo service_role la lee. Incluye anuladas '
  'y el historial DEV-. OJO: CREATE OR REPLACE VIEW pierde security_invoker si no lo repite, '
  'y recrearla devuelve los grants por default (repetir el REVOKE). Migracion 356.';
