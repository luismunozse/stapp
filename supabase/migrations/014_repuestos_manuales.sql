-- Permitir repuestos manuales (sin inventario)
-- Agregar campo para nombre del repuesto cuando es manual

-- Hacer inventario_id nullable
ALTER TABLE repuestos_orden
  ALTER COLUMN inventario_id DROP NOT NULL;

-- Agregar campo para nombre manual
ALTER TABLE repuestos_orden
  ADD COLUMN nombre TEXT;

-- Agregar constraint: debe tener inventario_id O nombre
ALTER TABLE repuestos_orden
  ADD CONSTRAINT repuesto_inventario_o_manual
  CHECK (inventario_id IS NOT NULL OR nombre IS NOT NULL);
