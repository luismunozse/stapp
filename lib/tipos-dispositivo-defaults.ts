/**
 * Configuraciones base por defecto para los tipos de dispositivo predefinidos.
 *
 * Estos configs se usan tanto al crear tipos base para una organización nueva
 * (ver `ensureTiposExist` en `app/api/tipos-dispositivo/route.ts`) como en las
 * migraciones de backfill para organizaciones que ya existen.
 *
 * IMPORTANTE: Mantener sincronizado con las migraciones SQL relevantes
 * (049_device_type_config.sql, 092_tipo_dispositivo_impresora.sql, etc.).
 */

export const TIPOS_BASE_CONFIG: Record<string, any> = {
  CELULAR: {
    campos: {
      imei: { visible: true, label: "IMEI", placeholder: "123456789012345", maxLength: 15 },
      password: { visible: true },
      color: { visible: true },
      marca: { visible: true },
    },
    camposExtra: [],
    accesorios: [
      { id: "cargador", label: "Cargador" },
      { id: "cable", label: "Cable USB" },
      { id: "funda", label: "Funda/Case" },
      { id: "vidrio", label: "Vidrio templado" },
      { id: "auriculares", label: "Auriculares" },
      { id: "sim", label: "Chip SIM" },
      { id: "memoria", label: "Tarjeta memoria" },
    ],
    problemasComunes: [
      "No enciende", "Pantalla rota", "No carga", "Batería se agota rápido",
      "Touch no funciona", "No reconoce SIM", "Cámara no funciona",
      "Altavoz no funciona", "Micrófono no funciona", "WiFi no conecta",
    ],
    marcas: ["Apple", "Samsung", "Xiaomi", "Motorola", "Huawei", "LG", "Sony", "OnePlus", "Oppo", "Realme"],
  },

  COMPUTADORA: {
    campos: {
      imei: { visible: false },
      password: { visible: true },
      color: { visible: true },
      marca: { visible: true },
    },
    camposExtra: [
      { key: "tipoPc", label: "Tipo de PC", tipo: "select", opciones: ["Notebook", "Desktop", "All-in-One"] },
      { key: "procesador", label: "Procesador", tipo: "text", placeholder: "i5, Ryzen 5..." },
      { key: "ram", label: "RAM", tipo: "select", opciones: ["2GB", "4GB", "8GB", "16GB", "32GB", "No sabe"] },
      { key: "almacenamiento", label: "Almacenamiento", tipo: "select", opciones: ["HDD 500GB", "HDD 1TB", "SSD 128GB", "SSD 256GB", "SSD 512GB", "SSD 1TB", "No sabe"] },
      { key: "sistemaOperativo", label: "Sistema Operativo", tipo: "buttons", opciones: ["Windows 11", "Windows 10", "Windows 7", "Linux", "macOS", "No inicia"] },
    ],
    accesorios: [
      { id: "cargador_notebook", label: "Cargador/Fuente" },
      { id: "mouse", label: "Mouse" },
      { id: "teclado", label: "Teclado" },
      { id: "bolso", label: "Bolso/Mochila" },
      { id: "disco_externo", label: "Disco externo" },
      { id: "pendrive", label: "Pendrive" },
      { id: "monitor", label: "Monitor" },
      { id: "cables_video", label: "Cables video" },
    ],
    problemasComunes: [
      "No enciende", "Pantalla azul (BSOD)", "Muy lenta / Se congela",
      "No carga batería (notebook)", "Teclado no funciona", "No detecta WiFi",
      "Disco lleno / Sin espacio", "Virus / Malware", "No inicia Windows",
      "Pantalla rota (notebook)", "Se apaga sola / Sobrecalienta",
      "No reconoce USB", "Sin audio", "Actualización fallida", "Formateo y reinstalación",
    ],
    marcas: ["HP", "Dell", "Lenovo", "Asus", "Acer", "Apple", "MSI", "Toshiba", "Samsung", "Armada/Genérica"],
    infoSectionTitle: "Información del Equipo",
    infoSectionIcon: "💻",
    infoSectionColor: "blue",
  },

  TABLET: {
    campos: {
      imei: { visible: true, label: "IMEI/Serial", placeholder: "Número de serie" },
      password: { visible: true },
      color: { visible: true },
      marca: { visible: true },
    },
    camposExtra: [],
    accesorios: [
      { id: "cargador", label: "Cargador" },
      { id: "cable", label: "Cable USB" },
      { id: "funda", label: "Funda/Case" },
      { id: "teclado_bt", label: "Teclado Bluetooth" },
      { id: "stylus", label: "Stylus/Lápiz" },
      { id: "memoria", label: "Tarjeta memoria" },
    ],
    problemasComunes: [
      "No enciende", "Pantalla rota", "No carga",
      "Batería se agota rápido", "Touch no responde", "Muy lenta", "No conecta WiFi",
    ],
    marcas: ["Apple", "Samsung", "Huawei", "Lenovo", "Amazon", "Xiaomi"],
  },

  CONSOLA: {
    campos: {
      imei: { visible: true, label: "Número de Serie", placeholder: "S/N de la consola" },
      password: { visible: false },
      color: { visible: false },
      marca: { visible: false },
    },
    camposExtra: [
      {
        key: "modeloConsola",
        label: "Modelo de Consola",
        tipo: "select",
        usarComoDispositivo: true,
        autoMarca: {
          PlayStation: "Sony PlayStation",
          Xbox: "Microsoft Xbox",
          Nintendo: "Nintendo",
          Switch: "Nintendo",
          Wii: "Nintendo",
          "3DS": "Nintendo",
        },
        opciones: [
          "PlayStation 5", "PlayStation 5 Digital", "PlayStation 4 Pro", "PlayStation 4 Slim",
          "PlayStation 4", "PlayStation 3", "Xbox Series X", "Xbox Series S",
          "Xbox One X", "Xbox One S", "Xbox One", "Xbox 360",
          "Nintendo Switch", "Nintendo Switch OLED", "Nintendo Switch Lite",
          "Nintendo Wii U", "Nintendo Wii", "Nintendo 3DS",
        ],
      },
      { key: "cantidadControles", label: "Cantidad de Controles", tipo: "counter", min: 0, max: 4 },
    ],
    accesorios: [
      { id: "fuente", label: "Fuente de poder" },
      { id: "cable_hdmi", label: "Cable HDMI" },
      { id: "control1", label: "Control 1" },
      { id: "control2", label: "Control 2" },
      { id: "control3", label: "Control 3" },
      { id: "control4", label: "Control 4" },
      { id: "auriculares", label: "Auriculares/Headset" },
      { id: "base_carga", label: "Base de carga" },
      { id: "disco_externo", label: "Disco externo" },
      { id: "juegos", label: "Juegos físicos" },
    ],
    problemasComunes: [
      "No enciende", "No lee discos", "Se apaga sola / Sobrecalienta",
      "No conecta a internet", "Control no sincroniza", "Sin imagen HDMI",
      "Error de sistema", "Hace ruido extraño", "Puerto HDMI dañado",
      "Actualización fallida", "Luz parpadeante", "Expulsa discos sola",
      "Drift en control (joystick)",
    ],
    marcas: ["Sony PlayStation", "Microsoft Xbox", "Nintendo"],
    infoSectionTitle: "Información de la Consola",
    infoSectionIcon: "🎮",
    infoSectionColor: "purple",
  },

  SMARTWATCH: {
    campos: {
      imei: { visible: false },
      password: { visible: false },
      color: { visible: true },
      marca: { visible: true },
    },
    camposExtra: [],
    accesorios: [
      { id: "cargador", label: "Cargador" },
      { id: "cable", label: "Cable USB" },
      { id: "malla", label: "Malla/Correa" },
      { id: "caja", label: "Caja original" },
    ],
    problemasComunes: [
      "No enciende", "No carga", "Pantalla rota", "No sincroniza", "Batería dura poco",
    ],
    marcas: ["Apple", "Samsung", "Huawei", "Xiaomi", "Amazfit", "Garmin", "Fitbit"],
  },

  IMPRESORA: {
    campos: {
      imei: { visible: true, label: "Número de Serie", placeholder: "S/N de la impresora" },
      password: { visible: false },
      color: { visible: true },
      marca: { visible: true },
    },
    camposExtra: [
      {
        key: "tipoImpresora", label: "Tipo de impresora", tipo: "select", opciones: [
          "Inyección de tinta", "Láser monocromática", "Láser color",
          "Multifunción tinta", "Multifunción láser", "Sistema continuo",
          "Matriz de puntos", "Térmica / Tickets", "Etiquetadora", "Plotter", "3D",
        ],
      },
      {
        key: "conectividad", label: "Conectividad", tipo: "select", opciones: [
          "USB", "WiFi", "Ethernet (red)", "USB + WiFi", "Bluetooth", "Paralelo / LPT",
        ],
      },
      {
        key: "consumible", label: "Consumible", tipo: "select", opciones: [
          "Cartucho original", "Cartucho alternativo", "Cartucho recargado",
          "Tóner original", "Tóner alternativo", "Sistema continuo (tinta)",
          "Cinta", "Otro", "No sabe",
        ],
      },
      { key: "modeloConsumible", label: "Modelo de cartucho/tóner", tipo: "text", placeholder: "Ej: HP 664, Brother TN-1060, Epson 664" },
      { key: "contadorPaginas", label: "Contador de páginas", tipo: "text", placeholder: "Si lo conoce" },
      { key: "imprimeTest", label: "¿Imprime hoja de prueba?", tipo: "buttons", opciones: ["Sí", "No", "Parcialmente", "No enciende"] },
      { key: "trajoConsumibles", label: "¿Trajo cartuchos/tóner?", tipo: "buttons", opciones: ["Sí", "No"] },
    ],
    accesorios: [
      { id: "cable_poder", label: "Cable de poder" },
      { id: "cable_usb", label: "Cable USB" },
      { id: "cable_red", label: "Cable de red" },
      { id: "cartuchos", label: "Cartuchos / Tóner" },
      { id: "bandeja_papel", label: "Bandeja de papel" },
      { id: "tapa", label: "Tapa / Cubierta" },
      { id: "cd_drivers", label: "CD de drivers" },
      { id: "manual", label: "Manual" },
      { id: "caja_original", label: "Caja original" },
    ],
    problemasComunes: [
      "No enciende", "No imprime", "Atasco de papel", "No toma el papel",
      "Toma varias hojas a la vez", "Imprime con manchas o rayas",
      "Imprime con franjas / faltan colores", "Cabezal seco / tapado",
      "Cartucho no reconocido", "Tóner no reconocido", "Error de chip",
      "Pide alineación de cabezales", "Error de firmware",
      "Luces parpadeando / error general", "No conecta por WiFi",
      "No conecta por USB", "No imprime desde el celular", "Escáner no funciona",
      "Mantenimiento / limpieza general", "Reset de almohadillas (waste ink)",
      "Instalación de sistema continuo",
    ],
    marcas: ["HP", "Epson", "Brother", "Canon", "Samsung", "Xerox", "Lexmark", "Ricoh", "Kyocera", "Pantum", "OKI", "Zebra"],
    infoSectionTitle: "Información de la Impresora",
    infoSectionIcon: "🖨️",
    infoSectionColor: "blue",
  },

  TODOS: {
    campos: {
      imei: { visible: true, label: "Número de Serie", placeholder: "S/N del equipo" },
      password: { visible: false },
      color: { visible: true },
      marca: { visible: true },
    },
    camposExtra: [],
    accesorios: [
      { id: "cable_poder", label: "Cable de poder" },
      { id: "cargador", label: "Cargador/Fuente" },
      { id: "cable_datos", label: "Cable de datos" },
      { id: "control_remoto", label: "Control remoto" },
      { id: "manual", label: "Manual" },
      { id: "caja_original", label: "Caja original" },
    ],
    problemasComunes: [
      "No enciende", "No funciona correctamente", "Hace ruido extraño",
      "Se apaga solo", "Error en pantalla/display", "No conecta a red/WiFi",
      "Mantenimiento preventivo", "Revisión general",
    ],
    marcas: [],
  },
}

// ACCESORIOS no tiene preset propio en las migraciones; usa el genérico de TODOS.
TIPOS_BASE_CONFIG.ACCESORIOS = TIPOS_BASE_CONFIG.TODOS

/**
 * Config de fallback para tipos sin preset conocido (incluye tipos personalizados).
 */
export const DEFAULT_TIPO_CONFIG = TIPOS_BASE_CONFIG.TODOS

export function getTipoBaseConfig(codigo: string) {
  return TIPOS_BASE_CONFIG[codigo] ?? DEFAULT_TIPO_CONFIG
}
