-- Migration 308: texto libre del rubro para el camino generico guiado.
--
-- Cuando alguien elige "Otro servicio tecnico" en el registro escribe que
-- repara ("maquinas de cafe", "cortadoras de pasto", "cerraduras"). De ahi se
-- deriva el tipo de equipo y el vocabulario de la organizacion — ver
-- lib/rubros/detalle.ts.
--
-- Se guarda por dos razones:
--   1. Trazabilidad: si una org quedo mal configurada se puede ver que escribio.
--   2. Producto: es la lista de oficios reales que piden los usuarios y no
--      tienen pack curado. Es el insumo para decidir cual escribir despues,
--      en vez de adivinar.
--
-- NULL para todas las orgs existentes y para las que eligen un pack curado.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rubro_detalle TEXT;

COMMENT ON COLUMN organizations.rubro_detalle IS
  'Texto libre que escribio el usuario al elegir el rubro generico. NULL si eligio un pack curado.';

-- Consulta de producto: que oficios piden los que caen en el generico.
--   SELECT rubro_detalle, COUNT(*) FROM organizations
--   WHERE rubro = 'generico' AND rubro_detalle IS NOT NULL
--   GROUP BY rubro_detalle ORDER BY COUNT(*) DESC;
CREATE INDEX IF NOT EXISTS organizations_rubro_detalle_idx
  ON organizations(rubro_detalle)
  WHERE rubro_detalle IS NOT NULL;
