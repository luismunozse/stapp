-- ============================================================================
-- 384: cerrar tablas y funciones accesibles con la anon key
-- ============================================================================
-- La anon key es pública (NEXT_PUBLIC_SUPABASE_ANON_KEY). Una política sin
-- `TO <rol>` aplica a PUBLIC, y por defecto anon/authenticated tienen
-- privilegios sobre las tablas de public. Estas tablas quedaron con políticas
-- `USING (true)` sin rol (034, 017, 025, 057, 201_sucursales_tabla, 265, 274,
-- 276) o directamente sin RLS (014, 115, 186).
--
-- La app accede a TODAS ellas con supabaseAdmin (service_role, que tiene
-- BYPASSRLS): ninguna se lee ni escribe desde el navegador. La única tabla que
-- el navegador consulta con la anon key es user_notifications (Realtime de la
-- campanita, hooks/use-notifications.ts) y NO se toca acá: cerrarla rompe la
-- campanita y necesita su propio cambio.
--
-- Qué hace, por tabla (si existe):
--   1. ENABLE ROW LEVEL SECURITY.
--   2. DROP de todas sus políticas. Las que había eran abiertas o filtraban
--      por una GUC que nunca se setea; service_role no las necesita.
--   3. REVOKE ALL a PUBLIC, anon y authenticated. Sin privilegio de tabla el
--      acceso se niega aunque alguien vuelva a crear una política abierta.
-- Y en funciones SECURITY DEFINER sin search_path que anon podía ejecutar:
-- search_path fijo y EXECUTE solo para service_role.
--
-- Idempotente: se puede re-ejecutar. Rollback: rollback/384_rollback.sql.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  v_tabla  TEXT;
  v_policy RECORD;
  v_tablas TEXT[] := ARRAY[
    -- políticas FOR ALL / USING (true) sin rol
    'sucursales',
    'sucursal_whatsapp_config',
    'asistente_conversaciones',
    'asistente_mensajes',
    'foto_borrador',
    'foto_borrador_item',
    'support_tickets',
    'support_ticket_messages',
    'support_ticket_attachments',
    'push_tokens',
    'broadcasts',
    'plans_audit',
    'chatbot_conversaciones',
    'chatbot_mensajes',
    -- tablas sin RLS
    'tipos_dispositivo',
    'notas_credito_counter',
    'audit_alert_config'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_tablas LOOP
    IF to_regclass(format('public.%I', v_tabla)) IS NULL THEN
      RAISE NOTICE '384: tabla % no existe, se omite', v_tabla;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabla);

    FOR v_policy IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tabla
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_tabla);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tabla);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tabla);
  END LOOP;
END $$;

-- Funciones SECURITY DEFINER sin search_path ejecutables por anon.
-- Las tres se llaman solo con supabaseAdmin.
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.audit_log_stats(timestamptz, timestamptz, timestamptz)',
    'public.cleanup_old_notifications()',
    'public.reset_ordenes_mes_if_needed(text)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE NOTICE '384: función % no existe, se omite', v_fn;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END $$;
