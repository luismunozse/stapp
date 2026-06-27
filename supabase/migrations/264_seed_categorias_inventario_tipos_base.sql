-- ========================================
-- Migration 264: seed categoriasInventario en tipos base (SP-2 multipropósito)
-- ========================================
-- Los tipos base no tenían categoriasInventario en su config (la 049 sembró
-- otros campos). Las sembramos con los valores que estaban hardcodeados en
-- inventario-form.tsx, para que sean editables desde la UI de config. El
-- fallback hardcodeado se mantiene en el front (versión segura). Idempotente:
-- solo donde aún no existe la clave (no pisa configs custom).
UPDATE tipos_dispositivo td
SET config = COALESCE(td.config, '{}'::jsonb)
  || jsonb_build_object('categoriasInventario', v.cats)
FROM (VALUES
  ('CELULAR',            '["Pantallas","Protectores","Baterías","Fundas","Cargadores","Flex","Módulos","Otros"]'::jsonb),
  ('COMPUTADORA',        '["Pantallas","Teclados","Baterías","Memorias","Discos","Cargadores","Otros"]'::jsonb),
  ('TABLET',             '["Pantallas","Protectores","Baterías","Fundas","Cargadores","Flex","Otros"]'::jsonb),
  ('CONSOLA',            '["Joysticks","Fuentes","Flex","Lectoras","Coolers","Otros"]'::jsonb),
  ('SMARTWATCH',         '["Mallas","Pantallas","Baterías","Cargadores","Otros"]'::jsonb),
  ('IMPRESORA',          '["Cartuchos","Tóners","Cabezales","Rodillos","Fuentes","Placas","Otros"]'::jsonb),
  ('NOTEBOOK',           '["Pantallas","Teclados","Baterías","Memorias","Discos","Cargadores","Bisagras","Otros"]'::jsonb),
  ('LAPTOP',             '["Pantallas","Teclados","Baterías","Memorias","Discos","Cargadores","Bisagras","Otros"]'::jsonb),
  ('TELEVISION',         '["Pantallas","Fuentes","Placas","LED","Cables","Controles","Otros"]'::jsonb),
  ('TV',                 '["Pantallas","Fuentes","Placas","LED","Cables","Controles","Otros"]'::jsonb),
  ('HELADERA',           '["Compresores","Termostatos","Motores","Válvulas","Resistencias","Otros"]'::jsonb),
  ('MICROONDAS',         '["Magnetrones","Fusibles","Motores","Placas","Otros"]'::jsonb),
  ('LAVARROPAS',         '["Motores","Bombas","Correas","Electrválvulas","Placas","Otros"]'::jsonb),
  ('AIRE_ACONDICIONADO', '["Compresores","Filtros","Motores","Placas","Gas refrigerante","Otros"]'::jsonb),
  ('ACCESORIOS',         '["Auriculares","Parlantes","Cables","Adaptadores","Cargadores","Soportes","Otros"]'::jsonb),
  ('TODOS',              '["Pantallas","Baterías","Fundas","Teclados","Memorias","Cargadores","Otros"]'::jsonb)
) AS v(codigo, cats)
WHERE td.codigo = v.codigo
  AND td.es_base = true
  AND NOT (td.config ? 'categoriasInventario');
