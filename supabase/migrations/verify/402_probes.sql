-- Verificación de garantias_configuracion_avisos (402).
--
-- Correr DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/402_probes.sql
-- (sin --apply: termina en ROLLBACK). Las filas de prueba se deshacen.
--
-- Resultado: UN select, todo en ok = true.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r
SELECT 1, 'columnas nuevas en organizations', '3', count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'organizations'
  AND column_name IN ('garantia_terminos', 'garantia_ventana_por_vencer_dias', 'garantia_aviso_vencimiento');

INSERT INTO _r
SELECT 2, 'ventana y aviso NOT NULL', '2', count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'organizations' AND is_nullable = 'NO'
  AND column_name IN ('garantia_ventana_por_vencer_dias', 'garantia_aviso_vencimiento');

INSERT INTO _r
SELECT 3, 'restricciones validadas', '2', count(*)::text
FROM pg_constraint
WHERE conrelid = 'public.organizations'::regclass AND convalidated
  AND conname IN ('organizations_garantia_terminos_largo', 'organizations_garantia_ventana_rango');

INSERT INTO _r
SELECT 4, 'ninguna org con el aviso prendido (default apagado)', '0', count(*)::text
FROM organizations WHERE garantia_aviso_vencimiento;

INSERT INTO _r
SELECT 5, 'toda org con ventana entre 1 y 90', '0', count(*)::text
FROM organizations WHERE garantia_ventana_por_vencer_dias NOT BETWEEN 1 AND 90;

INSERT INTO _r
SELECT 6, 'marca de aviso en garantias y garantias_venta', '2', count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'aviso_vencimiento_enviado_at'
  AND table_name IN ('garantias', 'garantias_venta');

INSERT INTO _r
SELECT 7, 'tipo_notificacion tiene los dos valores nuevos', '2', count(*)::text
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'tipo_notificacion' AND e.enumlabel IN ('REINGRESO_GARANTIA', 'GARANTIA_POR_VENCER');

-- La ventana fuera de rango y los términos de más de 2000 caracteres se rechazan.
DO $$
DECLARE v_org TEXT;
BEGIN
  SELECT id INTO v_org FROM organizations LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO _r VALUES (8, 'ventana 0 rechazada', 'rechazada', 'sin candidato');
    RETURN;
  END IF;
  BEGIN
    UPDATE organizations SET garantia_ventana_por_vencer_dias = 0 WHERE id = v_org;
    INSERT INTO _r VALUES (8, 'ventana 0 rechazada', 'rechazada', 'aceptada');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES (8, 'ventana 0 rechazada', 'rechazada', 'rechazada');
  END;
  BEGIN
    UPDATE organizations SET garantia_terminos = repeat('x', 2001) WHERE id = v_org;
    INSERT INTO _r VALUES (9, 'términos de 2001 caracteres rechazados', 'rechazada', 'aceptada');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES (9, 'términos de 2001 caracteres rechazados', 'rechazada', 'rechazada');
  END;
  BEGIN
    UPDATE organizations SET garantia_terminos = repeat('x', 2000), garantia_ventana_por_vencer_dias = 90 WHERE id = v_org;
    INSERT INTO _r VALUES (10, 'términos de 2000 y ventana 90 aceptados', 'aceptada', 'aceptada');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (10, 'términos de 2000 y ventana 90 aceptados', 'aceptada', SQLERRM);
  END;
END $$;

-- El UPDATE condicional del cron marca una sola vez.
DO $$
DECLARE v_g TEXT; v_n1 INT; v_n2 INT;
BEGIN
  SELECT id INTO v_g FROM garantias WHERE aviso_vencimiento_enviado_at IS NULL LIMIT 1;
  IF v_g IS NULL THEN
    INSERT INTO _r VALUES (11, 'la marca de aviso se toma una sola vez', '1/0', 'sin candidato');
    RETURN;
  END IF;
  UPDATE garantias SET aviso_vencimiento_enviado_at = NOW() WHERE id = v_g AND aviso_vencimiento_enviado_at IS NULL;
  GET DIAGNOSTICS v_n1 = ROW_COUNT;
  UPDATE garantias SET aviso_vencimiento_enviado_at = NOW() WHERE id = v_g AND aviso_vencimiento_enviado_at IS NULL;
  GET DIAGNOSTICS v_n2 = ROW_COUNT;
  INSERT INTO _r VALUES (11, 'la marca de aviso se toma una sola vez', '1/0', v_n1 || '/' || v_n2);
END $$;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
