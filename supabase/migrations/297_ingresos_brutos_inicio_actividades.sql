-- 297: Ingresos brutos + inicio de actividades del emisor (remito formato clásico)
-- Ambos TEXT nullable: se muestran en el encabezado del remito solo si están cargados.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ingresos_brutos TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS inicio_actividades TEXT;

COMMENT ON COLUMN organizations.ingresos_brutos IS
  'Número de inscripción en Ingresos Brutos del emisor (texto libre, ej: 902-123456-7). Encabezado del remito.';
COMMENT ON COLUMN organizations.inicio_actividades IS
  'Fecha de inicio de actividades del emisor (texto libre, ej: 01/2020). Encabezado del remito.';
