-- ============================================================================
-- 405: permiso opt-in para que los TECNICO consulten la deuda de clientes
-- ============================================================================
-- Preferencia por organización (default apagado), mismo patrón que 374
-- (tecnicos_toman_ordenes): una preferencia de la org, NO un gate de plan.
--
-- Por qué existe: el asistente de STApp puede responder cuánto debe un cliente
-- (fiado + órdenes sin cobrar). Decisión del dueño (2026-11-12): un técnico no
-- ve esa deuda salvo que el administrador lo habilite.
--
-- Qué NO cambia: el saldo de una orden puntual que el técnico ya puede abrir.
-- Aditiva: el código viejo no la lee; el nuevo la lee fail-closed (sin columna
-- o con error de lectura = apagado).
-- ============================================================================
SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tecnicos_ven_deuda_clientes BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.tecnicos_ven_deuda_clientes IS
  'Si es true, los usuarios TECNICO pueden consultar la deuda de los clientes desde el asistente. Default false. No modifica el rol.';
