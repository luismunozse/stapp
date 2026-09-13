-- ============================================================================
-- 322: permiso opcional para que los TECNICOS cobren sus propias cotizaciones
-- ============================================================================
-- Toggle por organizacion (default apagado), mismo patron que la 275
-- (vendedores_administran_inventario), la 314 (tecnicos_operan_pos) y la 320
-- (vendedores_manejan_caja): preferencia de la org, NO gating comercial por
-- plan (eso vive en plans.feature_flags).
--
-- Existe porque el tecnico ya cotiza —crear, enviar, aprobar y duplicar sus
-- cotizaciones fue siempre suyo, y la API lo tiene escrito con alcance por
-- `created_by`— pero convertir la cotizacion aceptada en venta era
-- requireAuth + `role !== "ADMIN"` duro. En un taller donde el tecnico
-- diagnostica, presupuesta y entrega el equipo en mano, la cotizacion muere
-- ahi: cada cobro necesita que el dueno lo cierre por el.
--
-- Lo que el permiso SI abre: POST
-- /api/cotizaciones/[id]/convertir-venta sobre las cotizaciones QUE EL
-- TECNICO CREO. El alcance por `created_by` no lo da este flag, lo da el
-- handler, igual que en aprobar, enviar y duplicar: el permiso lo habilita a
-- cerrar SU trabajo, no el del resto del equipo.
--
-- Lo que el permiso NO abre: eliminar cotizaciones, revisarlas
-- (`/revisar`) y convertirlas en orden de servicio (`/convertir-orden`)
-- siguen siendo solo de ADMIN. Tampoco abre el POS: la venta que genera se
-- le acredita como vendedor, pero para verla en Ventas hace falta ademas
-- `tecnicos_operan_pos` (314), que es un permiso distinto y se prende aparte.
--
-- No modifica el rol del usuario. Es una SUMA sobre el rol TECNICO, no un
-- canje a VENDEDOR: el tecnico sigue recibiendo ordenes asignadas y
-- conservando sus comisiones de reparacion.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tecnicos_cobran_cotizaciones BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.tecnicos_cobran_cotizaciones IS
  'Si true, los usuarios con rol TECNICO pueden convertir en venta las cotizaciones aceptadas QUE ELLOS CREARON. No incluye eliminar, revisar ni convertir a orden de servicio, que siguen siendo de ADMIN, ni el acceso al POS (ver tecnicos_operan_pos). Default false. No modifica el rol del usuario.';
