/**
 * Utilidades centralizadas para tipos de dispositivo.
 *
 * Los tipos de dispositivo son customizables por organización (tabla tipos_dispositivo).
 * Estas funciones proveen labels e íconos con fallback para cualquier código,
 * incluyendo tipos que aún no existían cuando se escribió este archivo.
 */

// ── Labels conocidos (fallback cuando no hay nombre de DB) ──────────────
const KNOWN_LABELS: Record<string, string> = {
  // Electrónica de consumo
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  SMARTWATCH: "Smartwatch",
  NOTEBOOK: "Notebook",
  LAPTOP: "Laptop",
  PC: "PC",
  // Periféricos
  IMPRESORA: "Impresora",
  SCANNER: "Escáner",
  PROYECTOR: "Proyector",
  // Audio / Video
  TELEVISION: "Televisión",
  TV: "TV",
  CAMARA: "Cámara",
  AUDIFONOS: "Audífonos",
  AURICULARES: "Auriculares",
  // Redes / Almacenamiento
  ROUTER: "Router",
  DISCO_DURO: "Disco Duro",
  SERVIDOR: "Servidor",
  // Electrodomésticos
  HELADERA: "Heladera",
  FREEZER: "Freezer",
  MICROONDAS: "Microondas",
  LAVARROPAS: "Lavarropas",
  LAVAVAJILLAS: "Lavavajillas",
  SECARROPAS: "Secarropas",
  AIRE_ACONDICIONADO: "Aire Acondicionado",
  VENTILADOR: "Ventilador",
  HORNO: "Horno",
  COCINA: "Cocina",
  CALEFACTOR: "Calefactor",
  ELECTRODOMESTICO: "Electrodoméstico",
  // Otros
  DRONE: "Drone",
  ACCESORIOS: "Accesorios",
  TODOS: "Todos",
  OTRO: "Otro",
}

/**
 * Convierte un código como "DISCO_DURO" a "Disco Duro".
 * Se usa como último fallback cuando el código no está en KNOWN_LABELS
 * ni viene nombre de la DB.
 */
function formatCode(code: string): string {
  return code
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Obtiene el label legible de un tipo de dispositivo.
 * Prioridad: nombreDB > mapa conocido > formateo automático del código.
 */
export function getDeviceTypeLabel(code: string, nombreDB?: string | null): string {
  if (nombreDB) return nombreDB
  return KNOWN_LABELS[code] || formatCode(code)
}

// ── Nombres de íconos Lucide por tipo ───────────────────────────────────
// Se mapean a strings para que el componente pueda importarlos dinámicamente
// o usarlos con un mapa local de componentes.
const KNOWN_ICON_NAMES: Record<string, string> = {
  // Electrónica de consumo
  CELULAR: "Smartphone",
  COMPUTADORA: "Monitor",
  TABLET: "Tablet",
  CONSOLA: "Gamepad2",
  SMARTWATCH: "Watch",
  NOTEBOOK: "Monitor",
  LAPTOP: "Monitor",
  PC: "Monitor",
  // Periféricos
  IMPRESORA: "Printer",
  SCANNER: "ScanLine",
  PROYECTOR: "Projector",
  // Audio / Video
  TELEVISION: "Tv",
  TV: "Tv",
  CAMARA: "Camera",
  AUDIFONOS: "Headphones",
  AURICULARES: "Headphones",
  // Redes / Almacenamiento
  ROUTER: "Router",
  DISCO_DURO: "HardDrive",
  SERVIDOR: "Cpu",
  // Electrodomésticos
  HELADERA: "Refrigerator",
  FREEZER: "Snowflake",
  MICROONDAS: "Microwave",
  LAVARROPAS: "WashingMachine",
  LAVAVAJILLAS: "WashingMachine",
  SECARROPAS: "Wind",
  AIRE_ACONDICIONADO: "AirVent",
  VENTILADOR: "Fan",
  HORNO: "Zap",
  COCINA: "Zap",
  CALEFACTOR: "Zap",
  ELECTRODOMESTICO: "Plug",
  // Otros
  DRONE: "Plane",
}

/**
 * Obtiene el nombre del ícono Lucide para un tipo de dispositivo.
 * Devuelve "Package" como fallback genérico.
 */
export function getDeviceTypeIconName(code: string): string {
  return KNOWN_ICON_NAMES[code] || "Package"
}
