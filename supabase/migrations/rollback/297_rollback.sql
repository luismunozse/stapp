-- Rollback 297: quitar campos de encabezado del remito clásico

ALTER TABLE organizations
  DROP COLUMN IF EXISTS ingresos_brutos,
  DROP COLUMN IF EXISTS inicio_actividades;
