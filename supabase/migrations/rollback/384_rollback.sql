-- Rollback de 384 (cerrar tablas y funciones accesibles con la anon key).
--
-- SOLO PARA EMERGENCIAS: vuelve a dejar estas tablas y funciones accesibles
-- con la anon key pública, que es exactamente el hueco que cerró 384. Usarlo
-- únicamente si algo que dependía de ese acceso dejó de funcionar, y por el
-- tiempo mínimo necesario.
--
-- Restaura el efecto, no las políticas exactas: devuelve los privilegios por
-- defecto de Supabase y crea una política abierta por tabla (las tablas que no
-- tenían RLS vuelven a no tenerlo). Las funciones vuelven a ser ejecutables por
-- PUBLIC; el search_path fijo se deja, es inocuo.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  v_tabla TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY[
    'sucursales', 'sucursal_whatsapp_config', 'asistente_conversaciones',
    'asistente_mensajes', 'foto_borrador', 'foto_borrador_item',
    'support_tickets', 'support_ticket_messages', 'support_ticket_attachments',
    'push_tokens', 'broadcasts', 'plans_audit',
    'chatbot_conversaciones', 'chatbot_mensajes'
  ] LOOP
    IF to_regclass(format('public.%I', v_tabla)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS rollback_384_abierta ON public.%I', v_tabla);
    EXECUTE format('CREATE POLICY rollback_384_abierta ON public.%I FOR ALL USING (true) WITH CHECK (true)', v_tabla);
  END LOOP;

  FOREACH v_tabla IN ARRAY ARRAY['tipos_dispositivo', 'notas_credito_counter', 'audit_alert_config'] LOOP
    IF to_regclass(format('public.%I', v_tabla)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', v_tabla);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', v_tabla);
  END LOOP;
END $$;

DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.audit_log_stats(timestamptz, timestamptz, timestamptz)',
    'public.cleanup_old_notifications()',
    'public.reset_ordenes_mes_if_needed(text)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_fn);
  END LOOP;
END $$;
