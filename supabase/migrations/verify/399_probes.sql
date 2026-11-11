-- Verificación de garantias_desde_entrega (399).
--
-- Correr ANTES y DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/399_probes.sql
-- (sin --apply: termina en ROLLBACK). La entrega y la garantía de prueba se deshacen.
--
-- Resultado: UN select. Después de aplicar, todo en ok = true. Antes, 1, 3, 4 y 5 dan false.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r
SELECT 1, 'columnas garantia_presupuesto_dias y garantia_presupuesto_alcance', '2', count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ordenes_servicio'
  AND column_name IN ('garantia_presupuesto_dias', 'garantia_presupuesto_alcance');

-- tgtype bit 1 (valor 2) = BEFORE. Tiene que ser AFTER.
INSERT INTO _r
SELECT 2, 'trg_orden_cambio_estado_tiempo es AFTER', 'AFTER',
       COALESCE((SELECT CASE WHEN (tgtype & 2) = 0 THEN 'AFTER' ELSE 'BEFORE' END
                   FROM pg_trigger
                  WHERE tgname = 'trg_orden_cambio_estado_tiempo'
                    AND tgrelid = 'public.ordenes_servicio'::regclass), 'no existe');

INSERT INTO _r
SELECT 3, 'trigger de garantías que estira el token', '1', count(*)::text
FROM pg_trigger
WHERE tgname = 'trg_garantia_extiende_token_publico' AND tgrelid = 'public.garantias'::regclass;

-- Entregar una orden sin garantía: el token vence a los 30 días.
-- Después, una garantía de 90 días lo estira hasta el día siguiente a su vencimiento.
DO $$
DECLARE
  v_orden TEXT;
  v_expira TIMESTAMPTZ;
  v_venc TIMESTAMPTZ := date_trunc('day', NOW()) + INTERVAL '90 days 12 hours';
BEGIN
  SELECT o.id INTO v_orden
    FROM ordenes_servicio o
   WHERE o.estado = 'REPARADO'
     AND NOT EXISTS (SELECT 1 FROM garantias g WHERE g.orden_id = o.id)
   ORDER BY o.fecha_ingreso DESC NULLS LAST
   LIMIT 1;

  IF v_orden IS NULL THEN
    INSERT INTO _r VALUES (4, 'entregar fija el token a 30 días', '30', 'sin candidato');
    INSERT INTO _r VALUES (5, 'una garantía de 90 días estira el token', 'estirado', 'sin candidato');
    RETURN;
  END IF;

  UPDATE ordenes_servicio SET estado = 'ENTREGADO' WHERE id = v_orden;
  SELECT public_token_expires_at INTO v_expira FROM ordenes_servicio WHERE id = v_orden;
  INSERT INTO _r VALUES (4, 'entregar fija el token a 30 días', '30',
    COALESCE(round(EXTRACT(EPOCH FROM (v_expira - NOW())) / 86400)::text, 'NULL'));

  INSERT INTO garantias (orden_id, dias_validez, fecha_inicio, fecha_vencimiento)
  VALUES (v_orden, 90, NOW(), v_venc);
  SELECT public_token_expires_at INTO v_expira FROM ordenes_servicio WHERE id = v_orden;
  INSERT INTO _r VALUES (5, 'una garantía de 90 días estira el token', 'estirado',
    CASE WHEN v_expira = v_venc + INTERVAL '1 day' THEN 'estirado' ELSE COALESCE(v_expira::text, 'NULL') END);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (4, 'entregar y crear garantía', 'sin error', SQLERRM);
END $$;

-- Ninguna orden con garantía tiene el token venciendo antes que ella.
INSERT INTO _r
SELECT 6, 'tokens que vencen antes que su garantía', '0', count(*)::text
FROM ordenes_servicio o
JOIN garantias g ON g.orden_id = o.id
WHERE o.public_token_expires_at IS NOT NULL
  AND o.public_token_expires_at < g.fecha_vencimiento;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
