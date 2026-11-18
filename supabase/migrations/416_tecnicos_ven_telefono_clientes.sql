-- ============================================================================
-- 416: permiso para que los TECNICO vean el teléfono de los clientes
-- ============================================================================
-- Preferencia por organización, como la 326 (vendedores_ven_ingresos) y por el
-- mismo motivo que ella:
--
--   DEFAULT true, NO false.
--
-- Hoy todos los técnicos ven el teléfono. Este permiso QUITA algo que ya tienen:
-- nacer apagado le cambiaría la pantalla a todos los talleres de un día para el
-- otro. El administrador que lo pidió lo apaga; el resto no se entera.
--
-- Qué cubre cuando se apaga, para un usuario TECNICO: el teléfono del cliente
-- (clientes.telefono), el teléfono de contacto de la orden
-- (ordenes_servicio.telefono_contacto), el del contacto de un sector
-- (sectores_cliente.contacto_telefono) y el que queda copiado en la venta
-- (ventas.cliente_telefono). El servidor no se lo envía: ni en pantallas, ni en
-- PDF, ni en exportaciones, ni en el asistente, y tampoco puede buscar por él.
--
-- Qué NO cambia: ADMIN y VENDEDOR lo ven siempre. Los avisos automáticos al
-- cliente (WhatsApp/SMS/email) siguen saliendo, porque los envía el servidor.
-- El técnico puede seguir cargando el teléfono al dar de alta un cliente.
--
-- Aditiva: el código viejo no la lee.
-- ============================================================================
SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tecnicos_ven_telefono_clientes BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN organizations.tecnicos_ven_telefono_clientes IS
  'Si es false, los usuarios TECNICO no reciben el teléfono de los clientes. Default true. No modifica el rol.';
