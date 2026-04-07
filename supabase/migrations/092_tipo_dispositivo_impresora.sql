-- ============================================
-- Migration 092: Tipo de dispositivo IMPRESORA con preset completo
-- ============================================
-- Agrega IMPRESORA como tipo de dispositivo base con:
--   - Campos específicos (contador de páginas, tipo, conectividad, tóner/cartucho)
--   - Accesorios típicos al recibir el equipo
--   - Problemas comunes y marcas
-- Se inserta para todas las organizaciones existentes y se actualiza la
-- función poblar_tipos_dispositivo_base() para que las nuevas orgs lo
-- creen automáticamente.
-- ============================================

-- 1) Insertar IMPRESORA en todas las organizaciones existentes
INSERT INTO tipos_dispositivo (organization_id, codigo, nombre, prefijo_orden, es_base, orden)
SELECT id, 'IMPRESORA', 'Impresora', 'IMP', TRUE, 7
FROM organizations
ON CONFLICT (organization_id, codigo) DO NOTHING;

-- 2) Actualizar la función para incluir IMPRESORA en nuevas organizaciones
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
    (org_id, 'IMPRESORA', 'Impresora', 'IMP', TRUE, 7),
    (org_id, 'TODOS', 'Todos los dispositivos', 'ORD', TRUE, 99)
  ON CONFLICT (organization_id, codigo) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 3) Cargar el preset de configuración SOLO para filas IMPRESORA sin config.
--    Esto respeta cualquier personalización previa que alguna organización
--    haya hecho manualmente sobre un tipo IMPRESORA propio.
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": true, "label": "Número de Serie", "placeholder": "S/N de la impresora" },
    "password": { "visible": false },
    "color": { "visible": true },
    "marca": { "visible": true }
  },
  "camposExtra": [
    { "key": "tipoImpresora", "label": "Tipo de impresora", "tipo": "select", "opciones": [
      "Inyección de tinta",
      "Láser monocromática",
      "Láser color",
      "Multifunción tinta",
      "Multifunción láser",
      "Sistema continuo",
      "Matriz de puntos",
      "Térmica / Tickets",
      "Etiquetadora",
      "Plotter",
      "3D"
    ]},
    { "key": "conectividad", "label": "Conectividad", "tipo": "select", "opciones": [
      "USB", "WiFi", "Ethernet (red)", "USB + WiFi", "Bluetooth", "Paralelo / LPT"
    ]},
    { "key": "consumible", "label": "Consumible", "tipo": "select", "opciones": [
      "Cartucho original", "Cartucho alternativo", "Cartucho recargado",
      "Tóner original", "Tóner alternativo", "Sistema continuo (tinta)",
      "Cinta", "Otro", "No sabe"
    ]},
    { "key": "modeloConsumible", "label": "Modelo de cartucho/tóner", "tipo": "text", "placeholder": "Ej: HP 664, Brother TN-1060, Epson 664" },
    { "key": "contadorPaginas", "label": "Contador de páginas", "tipo": "text", "placeholder": "Si lo conoce" },
    { "key": "imprimeTest", "label": "¿Imprime hoja de prueba?", "tipo": "buttons", "opciones": ["Sí", "No", "Parcialmente", "No enciende"] },
    { "key": "trajoConsumibles", "label": "¿Trajo cartuchos/tóner?", "tipo": "buttons", "opciones": ["Sí", "No"] }
  ],
  "accesorios": [
    { "id": "cable_poder", "label": "Cable de poder" },
    { "id": "cable_usb", "label": "Cable USB" },
    { "id": "cable_red", "label": "Cable de red" },
    { "id": "cartuchos", "label": "Cartuchos / Tóner" },
    { "id": "bandeja_papel", "label": "Bandeja de papel" },
    { "id": "tapa", "label": "Tapa / Cubierta" },
    { "id": "cd_drivers", "label": "CD de drivers" },
    { "id": "manual", "label": "Manual" },
    { "id": "caja_original", "label": "Caja original" }
  ],
  "problemasComunes": [
    "No enciende",
    "No imprime",
    "Atasco de papel",
    "No toma el papel",
    "Toma varias hojas a la vez",
    "Imprime con manchas o rayas",
    "Imprime con franjas / faltan colores",
    "Cabezal seco / tapado",
    "Cartucho no reconocido",
    "Tóner no reconocido",
    "Error de chip",
    "Pide alineación de cabezales",
    "Error de firmware",
    "Luces parpadeando / error general",
    "No conecta por WiFi",
    "No conecta por USB",
    "No imprime desde el celular",
    "Escáner no funciona",
    "Mantenimiento / limpieza general",
    "Reset de almohadillas (waste ink)",
    "Instalación de sistema continuo"
  ],
  "marcas": [
    "HP", "Epson", "Brother", "Canon", "Samsung", "Xerox", "Lexmark",
    "Ricoh", "Kyocera", "Pantum", "OKI", "Zebra"
  ],
  "infoSectionTitle": "Información de la Impresora",
  "infoSectionIcon": "🖨️",
  "infoSectionColor": "blue"
}'::jsonb
WHERE codigo = 'IMPRESORA'
  AND (config IS NULL OR config = '{}'::jsonb);
