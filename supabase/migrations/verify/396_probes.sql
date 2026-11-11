-- Verificación de clientes_fk_sin_cascada (396).
--
-- Correr ANTES y DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/396_probes.sql
-- (sin --apply: termina en ROLLBACK). Los DELETE de prueba se deshacen.
--
-- Resultado: UN select. Después de aplicar, todo en ok = true. Antes, 1 y 2 dan false.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r
SELECT 1, 'FKs a clientes en NO ACTION (ordenes_servicio, cuenta_corriente, recepciones)', '3', count(*)::text
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'public.clientes'::regclass AND confdeltype = 'a' AND convalidated
  AND conname IN ('ordenes_servicio_cliente_id_fkey', 'cuenta_corriente_cliente_id_fkey', 'recepciones_cliente_id_fkey');

-- Un cliente con órdenes: el DELETE tiene que fallar.
DO $$
DECLARE v_cliente TEXT;
BEGIN
  SELECT cliente_id INTO v_cliente FROM ordenes_servicio WHERE cliente_id IS NOT NULL ORDER BY fecha_ingreso DESC NULLS LAST LIMIT 1;
  BEGIN
    DELETE FROM clientes WHERE id = v_cliente;
    INSERT INTO _r VALUES (2, 'borrar un cliente con órdenes', 'rechazado', 'borró');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO _r VALUES (2, 'borrar un cliente con órdenes', 'rechazado', 'rechazado');
  END;
END $$;

-- Un cliente sin ninguna referencia: el DELETE tiene que andar.
DO $$
DECLARE v_cliente TEXT; v_fk RECORD; v_ref BOOLEAN;
BEGIN
  FOR v_cliente IN SELECT id FROM clientes ORDER BY id DESC LIMIT 200 LOOP
    v_ref := FALSE;
    FOR v_fk IN
      SELECT c.conrelid::regclass AS tabla, a.attname AS columna
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND c.confrelid = 'public.clientes'::regclass
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tabla, v_fk.columna) INTO v_ref USING v_cliente;
      EXIT WHEN v_ref;
    END LOOP;
    IF NOT v_ref THEN
      DELETE FROM clientes WHERE id = v_cliente;
      INSERT INTO _r VALUES (3, 'borrar un cliente sin referencias', 'borró', 'borró');
      RETURN;
    END IF;
  END LOOP;
  INSERT INTO _r VALUES (3, 'borrar un cliente sin referencias', 'borró', 'sin candidato');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (3, 'borrar un cliente sin referencias', 'borró', SQLERRM);
END $$;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
