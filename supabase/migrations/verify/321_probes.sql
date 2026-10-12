-- Probes de la 321. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply.
BEGIN;

-- 1. Las seis columnas existen
SELECT 'col ' || column_name AS probe, 'OK' AS resultado
FROM information_schema.columns
WHERE table_name = 'notification_logs'
  AND column_name IN ('provider_message_id','proveedor','estado_entrega','delivered_at','bounced_at','bounce_tipo')
ORDER BY column_name;

-- 2. El CHECK de estado_entrega rechaza un valor invalido
DO $$
DECLARE
  fila_id TEXT;
BEGIN
  SELECT id INTO fila_id FROM notification_logs LIMIT 1;

  IF fila_id IS NULL THEN
    RAISE NOTICE 'SIN DATOS: notification_logs esta vacia, no se pudo ejercitar el CHECK de estado_entrega';
  ELSE
    BEGIN
      UPDATE notification_logs SET estado_entrega = 'CUALQUIERA' WHERE id = fila_id;
      RAISE EXCEPTION 'FALLO: el CHECK de estado_entrega no rechazo un valor invalido';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'OK: CHECK de estado_entrega activo';
    END;
  END IF;
END $$;

-- 3. El unique sobre la columna rechaza la direccion repetida
-- Direccion en el TLD reservado .invalid (RFC 2606): no puede existir de verdad.
DO $$
BEGIN
  INSERT INTO email_suprimidos (email, motivo) VALUES ('probe-321@example.invalid', 'MANUAL');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'AVISO: probe-321@example.invalid ya estaba suprimida; se reutiliza para la prueba';
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO email_suprimidos (email, motivo) VALUES ('probe-321@example.invalid', 'MANUAL');
    RAISE EXCEPTION 'FALLO: el unique index no rechazo la direccion repetida';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: unique index sobre email activo';
  END;
END $$;

-- 4. El CHECK de normalizacion rechaza mayusculas
DO $$
BEGIN
  BEGIN
    INSERT INTO email_suprimidos (email, motivo) VALUES ('PROBE-MAYUS@EXAMPLE.INVALID', 'MANUAL');
    RAISE EXCEPTION 'FALLO: el CHECK de normalizacion no rechazo mayusculas';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: CHECK de normalizacion activo';
  END;
END $$;

-- 5. El CHECK de normalizacion rechaza un espacio final
DO $$
BEGIN
  BEGIN
    INSERT INTO email_suprimidos (email, motivo) VALUES ('probe-espacio@example.invalid ', 'MANUAL');
    RAISE EXCEPTION 'FALLO: el CHECK de normalizacion no rechazo el espacio final';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: CHECK de normalizacion rechaza espacios al borde';
  END;
END $$;

-- 6. El CHECK de normalizacion rechaza un tab final
-- btrim(email) a secas solo recorta el caracter espacio; normalizar() en
-- lib/email/suppression.ts usa el trim() de JavaScript, que tambien recorta
-- tab. Esta prueba verifica que el CHECK cubra esa misma clase de caracteres
-- (ver btrim(email, E' \t\n\r') en la definicion de la tabla).
DO $$
BEGIN
  BEGIN
    INSERT INTO email_suprimidos (email, motivo) VALUES (E'probe-tab@example.invalid\t', 'MANUAL');
    RAISE EXCEPTION 'FALLO: el CHECK de normalizacion no rechazo el tab final';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: CHECK de normalizacion rechaza tab al borde';
  END;
END $$;

-- 7. RLS habilitado en email_suprimidos
SELECT 'rls email_suprimidos' AS probe,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'FALLO' END AS resultado
FROM pg_class WHERE relname = 'email_suprimidos';

ROLLBACK;
