-- ============================================
-- Migration 101: Backfill de config faltante en tipos_dispositivo base
-- ============================================
-- Bug: Las organizaciones creadas después de la migración 049 (y antes de
-- corregir `ensureTiposExist` en `app/api/tipos-dispositivo/route.ts`) recibían
-- los tipos base CELULAR/COMPUTADORA/TABLET/etc. con `config = '{}'`. Por eso
-- el formulario de orden caía al FALLBACK y ocultaba campos como
-- contraseña/patrón del teléfono.
--
-- Esta migración aplica la config preset SOLO a las filas de tipos base que
-- todavía no la tienen, sin pisar personalizaciones previas.
-- ============================================

-- CELULAR
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": true, "label": "IMEI", "placeholder": "123456789012345", "maxLength": 15 },
    "password": { "visible": true },
    "color": { "visible": true },
    "marca": { "visible": true }
  },
  "camposExtra": [],
  "accesorios": [
    { "id": "cargador", "label": "Cargador" },
    { "id": "cable", "label": "Cable USB" },
    { "id": "funda", "label": "Funda/Case" },
    { "id": "vidrio", "label": "Vidrio templado" },
    { "id": "auriculares", "label": "Auriculares" },
    { "id": "sim", "label": "Chip SIM" },
    { "id": "memoria", "label": "Tarjeta memoria" }
  ],
  "problemasComunes": [
    "No enciende", "Pantalla rota", "No carga", "Batería se agota rápido",
    "Touch no funciona", "No reconoce SIM", "Cámara no funciona",
    "Altavoz no funciona", "Micrófono no funciona", "WiFi no conecta"
  ],
  "marcas": ["Apple", "Samsung", "Xiaomi", "Motorola", "Huawei", "LG", "Sony", "OnePlus", "Oppo", "Realme"]
}'::jsonb
WHERE codigo = 'CELULAR'
  AND (config IS NULL OR config = '{}'::jsonb);

-- COMPUTADORA
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": false },
    "password": { "visible": true },
    "color": { "visible": true },
    "marca": { "visible": true }
  },
  "camposExtra": [
    { "key": "tipoPc", "label": "Tipo de PC", "tipo": "select", "opciones": ["Notebook", "Desktop", "All-in-One"] },
    { "key": "procesador", "label": "Procesador", "tipo": "text", "placeholder": "i5, Ryzen 5..." },
    { "key": "ram", "label": "RAM", "tipo": "select", "opciones": ["2GB", "4GB", "8GB", "16GB", "32GB", "No sabe"] },
    { "key": "almacenamiento", "label": "Almacenamiento", "tipo": "select", "opciones": ["HDD 500GB", "HDD 1TB", "SSD 128GB", "SSD 256GB", "SSD 512GB", "SSD 1TB", "No sabe"] },
    { "key": "sistemaOperativo", "label": "Sistema Operativo", "tipo": "buttons", "opciones": ["Windows 11", "Windows 10", "Windows 7", "Linux", "macOS", "No inicia"] }
  ],
  "accesorios": [
    { "id": "cargador_notebook", "label": "Cargador/Fuente" },
    { "id": "mouse", "label": "Mouse" },
    { "id": "teclado", "label": "Teclado" },
    { "id": "bolso", "label": "Bolso/Mochila" },
    { "id": "disco_externo", "label": "Disco externo" },
    { "id": "pendrive", "label": "Pendrive" },
    { "id": "monitor", "label": "Monitor" },
    { "id": "cables_video", "label": "Cables video" }
  ],
  "problemasComunes": [
    "No enciende", "Pantalla azul (BSOD)", "Muy lenta / Se congela",
    "No carga batería (notebook)", "Teclado no funciona", "No detecta WiFi",
    "Disco lleno / Sin espacio", "Virus / Malware", "No inicia Windows",
    "Pantalla rota (notebook)", "Se apaga sola / Sobrecalienta",
    "No reconoce USB", "Sin audio", "Actualización fallida", "Formateo y reinstalación"
  ],
  "marcas": ["HP", "Dell", "Lenovo", "Asus", "Acer", "Apple", "MSI", "Toshiba", "Samsung", "Armada/Genérica"],
  "infoSectionTitle": "Información del Equipo",
  "infoSectionIcon": "💻",
  "infoSectionColor": "blue"
}'::jsonb
WHERE codigo = 'COMPUTADORA'
  AND (config IS NULL OR config = '{}'::jsonb);

-- TABLET
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": true, "label": "IMEI/Serial", "placeholder": "Número de serie" },
    "password": { "visible": true },
    "color": { "visible": true },
    "marca": { "visible": true }
  },
  "camposExtra": [],
  "accesorios": [
    { "id": "cargador", "label": "Cargador" },
    { "id": "cable", "label": "Cable USB" },
    { "id": "funda", "label": "Funda/Case" },
    { "id": "teclado_bt", "label": "Teclado Bluetooth" },
    { "id": "stylus", "label": "Stylus/Lápiz" },
    { "id": "memoria", "label": "Tarjeta memoria" }
  ],
  "problemasComunes": [
    "No enciende", "Pantalla rota", "No carga",
    "Batería se agota rápido", "Touch no responde", "Muy lenta", "No conecta WiFi"
  ],
  "marcas": ["Apple", "Samsung", "Huawei", "Lenovo", "Amazon", "Xiaomi"]
}'::jsonb
WHERE codigo = 'TABLET'
  AND (config IS NULL OR config = '{}'::jsonb);

-- CONSOLA
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": true, "label": "Número de Serie", "placeholder": "S/N de la consola" },
    "password": { "visible": false },
    "color": { "visible": false },
    "marca": { "visible": false }
  },
  "camposExtra": [
    { "key": "modeloConsola", "label": "Modelo de Consola", "tipo": "select", "usarComoDispositivo": true, "autoMarca": {
      "PlayStation": "Sony PlayStation", "Xbox": "Microsoft Xbox", "Nintendo": "Nintendo", "Switch": "Nintendo", "Wii": "Nintendo", "3DS": "Nintendo"
    }, "opciones": [
      "PlayStation 5", "PlayStation 5 Digital", "PlayStation 4 Pro", "PlayStation 4 Slim",
      "PlayStation 4", "PlayStation 3", "Xbox Series X", "Xbox Series S",
      "Xbox One X", "Xbox One S", "Xbox One", "Xbox 360",
      "Nintendo Switch", "Nintendo Switch OLED", "Nintendo Switch Lite",
      "Nintendo Wii U", "Nintendo Wii", "Nintendo 3DS"
    ]},
    { "key": "cantidadControles", "label": "Cantidad de Controles", "tipo": "counter", "min": 0, "max": 4 }
  ],
  "accesorios": [
    { "id": "fuente", "label": "Fuente de poder" },
    { "id": "cable_hdmi", "label": "Cable HDMI" },
    { "id": "control1", "label": "Control 1" },
    { "id": "control2", "label": "Control 2" },
    { "id": "control3", "label": "Control 3" },
    { "id": "control4", "label": "Control 4" },
    { "id": "auriculares", "label": "Auriculares/Headset" },
    { "id": "base_carga", "label": "Base de carga" },
    { "id": "disco_externo", "label": "Disco externo" },
    { "id": "juegos", "label": "Juegos físicos" }
  ],
  "problemasComunes": [
    "No enciende", "No lee discos", "Se apaga sola / Sobrecalienta",
    "No conecta a internet", "Control no sincroniza", "Sin imagen HDMI",
    "Error de sistema", "Hace ruido extraño", "Puerto HDMI dañado",
    "Actualización fallida", "Luz parpadeante", "Expulsa discos sola",
    "Drift en control (joystick)"
  ],
  "marcas": ["Sony PlayStation", "Microsoft Xbox", "Nintendo"],
  "infoSectionTitle": "Información de la Consola",
  "infoSectionIcon": "🎮",
  "infoSectionColor": "purple"
}'::jsonb
WHERE codigo = 'CONSOLA'
  AND (config IS NULL OR config = '{}'::jsonb);

-- SMARTWATCH
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": false },
    "password": { "visible": false },
    "color": { "visible": true },
    "marca": { "visible": true }
  },
  "camposExtra": [],
  "accesorios": [
    { "id": "cargador", "label": "Cargador" },
    { "id": "cable", "label": "Cable USB" },
    { "id": "malla", "label": "Malla/Correa" },
    { "id": "caja", "label": "Caja original" }
  ],
  "problemasComunes": [
    "No enciende", "No carga", "Pantalla rota", "No sincroniza", "Batería dura poco"
  ],
  "marcas": ["Apple", "Samsung", "Huawei", "Xiaomi", "Amazfit", "Garmin", "Fitbit"]
}'::jsonb
WHERE codigo = 'SMARTWATCH'
  AND (config IS NULL OR config = '{}'::jsonb);

-- TODOS / ACCESORIOS (genérico)
UPDATE tipos_dispositivo SET config = '{
  "campos": {
    "imei": { "visible": true, "label": "Número de Serie", "placeholder": "S/N del equipo" },
    "password": { "visible": false },
    "color": { "visible": true },
    "marca": { "visible": true }
  },
  "camposExtra": [],
  "accesorios": [
    { "id": "cable_poder", "label": "Cable de poder" },
    { "id": "cargador", "label": "Cargador/Fuente" },
    { "id": "cable_datos", "label": "Cable de datos" },
    { "id": "control_remoto", "label": "Control remoto" },
    { "id": "manual", "label": "Manual" },
    { "id": "caja_original", "label": "Caja original" }
  ],
  "problemasComunes": [
    "No enciende", "No funciona correctamente", "Hace ruido extraño",
    "Se apaga solo", "Error en pantalla/display", "No conecta a red/WiFi",
    "Mantenimiento preventivo", "Revisión general"
  ],
  "marcas": []
}'::jsonb
WHERE codigo IN ('TODOS', 'ACCESORIOS')
  AND (config IS NULL OR config = '{}'::jsonb);

-- IMPRESORA: la migración 092 ya hace este backfill con la misma condición,
-- así que no se repite acá. Si una org la tiene en '{}' por algún motivo,
-- volver a correr 092 la dejaría correcta.
