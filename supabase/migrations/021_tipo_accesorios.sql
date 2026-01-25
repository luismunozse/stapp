-- ========================================
-- AGREGAR TIPO ACCESORIOS
-- ========================================

-- Agregar ACCESORIOS a todas las organizaciones existentes
INSERT INTO tipos_dispositivo (organization_id, codigo, nombre, prefijo_orden, es_base, orden)
SELECT id, 'ACCESORIOS', 'Accesorios', 'ACC', TRUE, 6
FROM organizations
ON CONFLICT (organization_id, codigo) DO NOTHING;

-- Actualizar la función para incluir ACCESORIOS en nuevas organizaciones
CREATE OR REPLACE FUNCTION poblar_tipos_dispositivo_base(org_id TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO tipos_dispositivo (organization_id, codigo, nombre, prefijo_orden, es_base, orden)
  VALUES
    (org_id, 'CELULAR', 'Celular', 'CEL', TRUE, 1),
    (org_id, 'COMPUTADORA', 'Computadora', 'PC', TRUE, 2),
    (org_id, 'TABLET', 'Tablet', 'TAB', TRUE, 3),
    (org_id, 'CONSOLA', 'Consola', 'CONS', TRUE, 4),
    (org_id, 'SMARTWATCH', 'Smartwatch', 'SW', TRUE, 5),
    (org_id, 'ACCESORIOS', 'Accesorios', 'ACC', TRUE, 6),
    (org_id, 'TODOS', 'Todos los dispositivos', 'ORD', TRUE, 99)
  ON CONFLICT (organization_id, codigo) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
