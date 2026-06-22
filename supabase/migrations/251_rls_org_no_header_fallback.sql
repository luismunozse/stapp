-- Migration 251: harden get_current_organization_id() — remove x-organization-id header fallback
-- ============================================================
-- F8 (auditoría facturación / seguridad): la función resolvía el org así:
--   COALESCE(jwt.claims->>'organization_id', request.headers->>'x-organization-id')
-- El anon key es público (NEXT_PUBLIC_SUPABASE_ANON_KEY) y la URL de PostgREST
-- también. Un atacante con el anon key podía pegarle a la REST API de Supabase
-- enviando el header `x-organization-id: <otra-org>`; como el JWT anónimo no
-- trae el claim organization_id, el COALESCE caía al header inyectable → RLS lo
-- aceptaba → lectura/escritura cross-tenant en facturas, ordenes_servicio,
-- clientes, etc. (IDOR total entre organizaciones).
--
-- Las rutas Next NO se ven afectadas: usan supabaseAdmin (service-role) que
-- bypassa RLS. El middleware inyecta x-organization-id solo a las rutas Next,
-- que no van a PostgREST. El realtime (notificaciones) tampoco: las conexiones
-- WebSocket no tienen `request.headers`, así que ahí la función ya hoy ignoraba
-- el header y usa el claim del JWT — sacar el fallback no cambia su comportamiento.
--
-- Fix: devolver únicamente el claim del JWT. Para una request anónima sin claim
-- la función devuelve NULL → las policies `organization_id = NULL` no matchean
-- ninguna fila (fail-closed), cerrando la fuga.
--
-- NOTA: aplicar a mano en el SQL editor de Supabase.
-- VERIFICAR tras aplicar: (1) que el ataque anon+header ya no devuelva filas;
-- (2) que las notificaciones en tiempo real sigan funcionando.
--
-- Rollback (definición vieja, NO usar salvo emergencia):
--   RETURN COALESCE(
--     current_setting('request.jwt.claims', true)::json->>'organization_id',
--     current_setting('request.headers', true)::json->>'x-organization-id'
--   );

CREATE OR REPLACE FUNCTION public.get_current_organization_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('request.jwt.claims', true)::json->>'organization_id';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
