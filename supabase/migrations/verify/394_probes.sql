-- Verificación de cobros_replay_antes_de_validar (394).
--
-- Correr DESPUÉS de aplicar (sin --apply: termina en ROLLBACK). Toma una orden y
-- una factura reales con saldo pendiente, salda TODO el pendiente con una clave
-- y reintenta con la misma clave. Todo se revierte.
--
-- Qué prueba, por cada función:
--   a  en el código, la clave se reclama antes del chequeo "excede el pendiente";
--   b  saldar todo el pendiente con una clave registra un pago;
--   c  el reintento con la misma clave es replay (antes: "excede el pendiente");
--   d  un cobro nuevo (otra clave) sobre la cuenta ya saldada sigue rechazado.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r
SELECT CASE p.proname WHEN 'registrar_cobros_orden_atomica' THEN 1 ELSE 5 END,
       p.proname || ' a: clave antes de validar el monto', 'true',
       (strpos(p.prosrc, 'INSERT INTO pago_idempotency') < strpos(p.prosrc, 'RAISE EXCEPTION ''El monto total'))::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('registrar_cobros_orden_atomica', 'registrar_pago_factura_atomica');

DO $$
DECLARE
  o RECORD; u TEXT; pend NUMERIC; r1 JSONB; r2 JSONB; err TEXT := 'sin error';
BEGIN
  SELECT * INTO o FROM ordenes_servicio
   WHERE COALESCE(costo_final, 0) - COALESCE(descuento_cobro, 0) - COALESCE(total_cobrado, 0) >= 1
     AND cliente_id IS NOT NULL
   ORDER BY fecha_ingreso DESC LIMIT 1;
  IF NOT FOUND THEN INSERT INTO _r VALUES (2, 'órdenes: hay una orden con saldo', 'sí', 'no'); RETURN; END IF;
  SELECT id INTO u FROM users WHERE organization_id = o.organization_id LIMIT 1;
  pend := COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0);
  r1 := registrar_cobros_orden_atomica(o.organization_id, o.id, u,
          jsonb_build_array(jsonb_build_object('monto', pend, 'metodo', 'EFECTIVO')), 'probe 394', 0, 'probe-394-orden');
  BEGIN
    r2 := registrar_cobros_orden_atomica(o.organization_id, o.id, u,
          jsonb_build_array(jsonb_build_object('monto', pend, 'metodo', 'EFECTIVO')), 'probe 394', 0, 'probe-394-orden');
  EXCEPTION WHEN OTHERS THEN
    r2 := jsonb_build_object('replayed', CASE WHEN SQLERRM LIKE '%excede el pendiente%' THEN 'error: excede el pendiente' ELSE 'error: ' || SQLERRM END);
  END;
  BEGIN
    PERFORM registrar_cobros_orden_atomica(o.organization_id, o.id, u,
          '[{"monto": 1, "metodo": "EFECTIVO"}]', 'probe 394', 0, 'probe-394-orden-otra');
  EXCEPTION WHEN OTHERS THEN err := CASE WHEN SQLERRM LIKE '%excede el pendiente%' THEN 'excede el pendiente' ELSE SQLERRM END;
  END;
  INSERT INTO _r VALUES
    (2, 'órdenes b: saldar todo con una clave', 'false', r1->>'replayed'),
    (3, 'órdenes c: reintento con la misma clave es replay', 'true', r2->>'replayed'),
    (4, 'órdenes d: otra clave sobre la cuenta saldada', 'excede el pendiente', err);
END $$;

DO $$
DECLARE
  f RECORD; u TEXT; pend NUMERIC; r1 JSONB; r2 JSONB; err TEXT := 'sin error';
BEGIN
  SELECT fa.*, o.organization_id AS org_id INTO f
    FROM facturas fa JOIN ordenes_servicio o ON o.id = fa.orden_id
   WHERE fa.estado_pago::text <> 'ANULADA' AND fa.total - COALESCE(fa.monto_abonado, 0) >= 1
   ORDER BY fa.fecha DESC LIMIT 1;
  IF NOT FOUND THEN INSERT INTO _r VALUES (6, 'facturas: hay una factura con saldo', 'sí', 'no'); RETURN; END IF;
  SELECT id INTO u FROM users WHERE organization_id = f.org_id LIMIT 1;
  pend := f.total - COALESCE(f.monto_abonado, 0);
  r1 := registrar_pago_factura_atomica(f.org_id, f.id, u, NULL, 'probe 394',
          jsonb_build_array(jsonb_build_object('monto', pend, 'metodo', 'EFECTIVO')), 'probe-394-factura');
  BEGIN
    r2 := registrar_pago_factura_atomica(f.org_id, f.id, u, NULL, 'probe 394',
          jsonb_build_array(jsonb_build_object('monto', pend, 'metodo', 'EFECTIVO')), 'probe-394-factura');
  EXCEPTION WHEN OTHERS THEN
    r2 := jsonb_build_object('replayed', CASE WHEN SQLERRM LIKE '%excede el pendiente%' THEN 'error: excede el pendiente' ELSE 'error: ' || SQLERRM END);
  END;
  BEGIN
    PERFORM registrar_pago_factura_atomica(f.org_id, f.id, u, NULL, 'probe 394',
          '[{"monto": 1, "metodo": "EFECTIVO"}]', 'probe-394-factura-otra');
  EXCEPTION WHEN OTHERS THEN err := CASE WHEN SQLERRM LIKE '%excede el pendiente%' THEN 'excede el pendiente' ELSE SQLERRM END;
  END;
  INSERT INTO _r VALUES
    (6, 'facturas b: saldar todo con una clave', 'false', r1->>'replayed'),
    (7, 'facturas c: reintento con la misma clave es replay', 'true', r2->>'replayed'),
    (8, 'facturas d: otra clave sobre la cuenta saldada', 'excede el pendiente', err);
END $$;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
