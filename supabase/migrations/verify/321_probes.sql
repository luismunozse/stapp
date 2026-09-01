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
BEGIN
  BEGIN
    UPDATE notification_logs SET estado_entrega = 'CUALQUIERA' WHERE id = (SELECT id FROM notification_logs LIMIT 1);
    RAISE EXCEPTION 'FALLO: el CHECK de estado_entrega no rechazo un valor invalido';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: CHECK de estado_entrega activo';
  END;
END $$;

-- 3. El indice unico de supresion es case-insensitive
INSERT INTO email_suprimidos (email, motivo) VALUES ('Test@Example.com', 'MANUAL');
DO $$
BEGIN
  BEGIN
    INSERT INTO email_suprimidos (email, motivo) VALUES ('test@example.com', 'MANUAL');
    RAISE EXCEPTION 'FALLO: el unique index no es case-insensitive';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: unique index case-insensitive activo';
  END;
END $$;

-- 4. RLS habilitado en email_suprimidos
SELECT 'rls email_suprimidos' AS probe,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'FALLO' END AS resultado
FROM pg_class WHERE relname = 'email_suprimidos';

ROLLBACK;
