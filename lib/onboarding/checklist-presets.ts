import type { TipoChecklist, CategoriaChecklist } from "@/types/database"

interface ChecklistPresetItem {
  label: string
  tipo: TipoChecklist
  categoria: CategoriaChecklist
  opciones: string | null
  orden: number
  requerido: boolean
}

interface ChecklistPreset {
  nombre: string
  tipoDispositivo: string
  items: ChecklistPresetItem[]
}

export const CHECKLIST_PRESETS: ChecklistPreset[] = [
  {
    nombre: "Recepción Celular",
    tipoDispositivo: "CELULAR",
    items: [
      // Condición física
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Rajaduras,Rota", orden: 1, requerido: true },
      { label: "Estado de carcasa/tapa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Rota", orden: 2, requerido: true },
      { label: "Estado del puerto de carga", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Sucio,Flojo,Dañado", orden: 3, requerido: true },
      // Funcional
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
      { label: "Pantalla táctil responde", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
      { label: "Carga del puerto funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: true },
      { label: "Botones físicos funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: true },
      { label: "Altavoz funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 8, requerido: false },
      { label: "Micrófono funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 9, requerido: false },
      { label: "Cámara trasera funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 10, requerido: false },
      { label: "Cámara frontal funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 11, requerido: false },
      { label: "WiFi / Bluetooth funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 12, requerido: false },
      { label: "Señal celular / llamadas", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 13, requerido: false },
      { label: "Touch ID / Face ID funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 14, requerido: false },
      { label: "Vibración funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 15, requerido: false },
      { label: "Estado de batería", tipo: "SELECT", categoria: "FUNCIONAL", opciones: "Bueno (>80%),Regular (50-80%),Malo (<50%),No retiene carga,No enciende", orden: 16, requerido: true },
      // Accesorios
      { label: "Cargador incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 17, requerido: true },
      { label: "Funda incluida", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 18, requerido: false },
      { label: "Tarjeta SIM incluida", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 19, requerido: false },
      { label: "Tarjeta de memoria incluida", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 20, requerido: false },
      // Otro
      { label: "Patrón / PIN / contraseña", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 21, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 22, requerido: false },
    ],
  },
  {
    nombre: "Recepción Notebook/PC",
    tipoDispositivo: "COMPUTADORA",
    items: [
      // Condición física
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Píxeles muertos,Manchas,Rota", orden: 1, requerido: true },
      { label: "Estado de carcasa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Rota", orden: 2, requerido: true },
      { label: "Estado de teclado", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Funcional,Teclas duras,Teclas faltantes,No funciona", orden: 3, requerido: true },
      { label: "Estado de bisagras", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Firmes,Flojas,Rotas", orden: 4, requerido: true },
      // Funcional
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
      { label: "Touchpad funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: true },
      { label: "Puertos USB funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: false },
      { label: "Puerto de carga funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 8, requerido: true },
      { label: "WiFi funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 9, requerido: false },
      { label: "Bluetooth funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 10, requerido: false },
      { label: "Altavoces funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 11, requerido: false },
      { label: "Micrófono funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 12, requerido: false },
      { label: "Cámara web funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 13, requerido: false },
      { label: "Salida de video (HDMI/VGA) funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 14, requerido: false },
      { label: "Lector de tarjetas funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 15, requerido: false },
      { label: "Estado de batería", tipo: "SELECT", categoria: "FUNCIONAL", opciones: "Buena duración,Duración reducida,No retiene carga,Sin batería,No aplica (PC de escritorio)", orden: 16, requerido: true },
      { label: "Disco/almacenamiento detectado", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 17, requerido: false },
      // Accesorios
      { label: "Cargador/fuente incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 18, requerido: true },
      { label: "Mouse incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 19, requerido: false },
      { label: "Bolso/maletín incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 20, requerido: false },
      // Otro
      { label: "Contraseña de sesión", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 21, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 22, requerido: false },
    ],
  },
  {
    nombre: "Recepción Consola",
    tipoDispositivo: "CONSOLA",
    items: [
      // Condición física
      { label: "Estado de carcasa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Rota", orden: 1, requerido: true },
      { label: "Estado de puertos (USB/HDMI/Red)", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Sucios,Flojos,Dañados", orden: 2, requerido: true },
      // Funcional
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: true },
      { label: "Salida HDMI funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
      { label: "Lectora de disco funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: false },
      { label: "Puertos USB funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
      { label: "WiFi / Bluetooth funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: false },
      { label: "Puerto de red (ethernet) funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 8, requerido: false },
      { label: "Ventilación adecuada (no se recalienta)", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 9, requerido: false },
      { label: "Audio funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 10, requerido: false },
      // Accesorios
      { label: "Controles/joysticks incluidos", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 11, requerido: true },
      { label: "Cantidad de controles", tipo: "TEXT", categoria: "ACCESORIOS", opciones: null, orden: 12, requerido: false },
      { label: "Estado de joysticks/botones", tipo: "SELECT", categoria: "ACCESORIOS", opciones: "Funcionan correctamente,Drift en analógicos,Botones duros,Gatillos flojos,No funcionan", orden: 13, requerido: false },
      { label: "Cable de alimentación incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 14, requerido: true },
      { label: "Cable HDMI incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 15, requerido: false },
      { label: "Base/soporte incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 16, requerido: false },
      { label: "Juegos/discos incluidos", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 17, requerido: false },
      // Otro
      { label: "Cuenta asociada (email)", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 18, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 19, requerido: false },
    ],
  },
  {
    nombre: "Recepción Tablet",
    tipoDispositivo: "TABLET",
    items: [
      // Condición física
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Rajaduras,Rota", orden: 1, requerido: true },
      { label: "Estado de carcasa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura", orden: 2, requerido: true },
      { label: "Estado del puerto de carga", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Sucio,Flojo,Dañado", orden: 3, requerido: true },
      // Funcional
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
      { label: "Pantalla táctil responde", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
      { label: "Carga correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: true },
      { label: "Botones funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: true },
      { label: "WiFi funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 8, requerido: false },
      { label: "Bluetooth funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 9, requerido: false },
      { label: "Altavoz funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 10, requerido: false },
      { label: "Micrófono funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 11, requerido: false },
      { label: "Cámara trasera funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 12, requerido: false },
      { label: "Cámara frontal funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 13, requerido: false },
      { label: "Sensor de rotación funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 14, requerido: false },
      { label: "Estado de batería", tipo: "SELECT", categoria: "FUNCIONAL", opciones: "Bueno (>80%),Regular (50-80%),Malo (<50%),No retiene carga", orden: 15, requerido: true },
      // Accesorios
      { label: "Cargador incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 16, requerido: true },
      { label: "Funda/cover incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 17, requerido: false },
      { label: "Lápiz/stylus incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 18, requerido: false },
      { label: "Teclado externo incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 19, requerido: false },
      // Otro
      { label: "Patrón / PIN / contraseña", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 20, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 21, requerido: false },
    ],
  },
  {
    nombre: "Recepción Smartwatch",
    tipoDispositivo: "SMARTWATCH",
    items: [
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Rajaduras,Rota", orden: 1, requerido: true },
      { label: "Estado de carcasa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura", orden: 2, requerido: true },
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: true },
      { label: "Touch funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
      { label: "Carga correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
      { label: "Sensor cardíaco funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
      { label: "Bluetooth funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: false },
      { label: "Cargador incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 8, requerido: true },
      { label: "Malla/correa incluida", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 9, requerido: true },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 10, requerido: false },
    ],
  },
  {
    nombre: "Recepción Impresora",
    tipoDispositivo: "IMPRESORA",
    items: [
      { label: "Estado exterior", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Rota", orden: 1, requerido: true },
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 2, requerido: true },
      { label: "Imprime hoja de prueba", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: false },
      { label: "Bandeja de papel funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: false },
      { label: "Scanner funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: false },
      { label: "WiFi/red funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
      { label: "Cable de poder incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 7, requerido: true },
      { label: "Cable USB incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 8, requerido: false },
      { label: "Cartuchos/tóner incluidos", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 9, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 10, requerido: false },
    ],
  },
  {
    nombre: "Recepción Electrodoméstico",
    tipoDispositivo: "_GENERICO_ELECTRODOMESTICO",
    items: [
      { label: "Estado exterior", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Oxidado,Roto", orden: 1, requerido: true },
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 2, requerido: true },
      { label: "Hace ruidos anormales", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: false },
      { label: "Cable de alimentación incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 4, requerido: true },
      { label: "Control remoto incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 5, requerido: false },
      { label: "Modelo/número de serie", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 6, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 7, requerido: false },
    ],
  },
]

/**
 * NOTA: `installChecklistPresets()` vivia aca y no la llamaba nadie (241 lineas
 * de codigo muerto). Su logica, generalizada a cualquier rubro, esta ahora en
 * `lib/rubros/seed.ts`, que ademas normaliza `opciones` a JSON array — el
 * formato que espera la UI y que estos presets nunca respetaron.
 *
 * `CHECKLIST_PRESETS` sigue vivo: lo consumen los packs de electronica y
 * electrodomesticos en `lib/rubros/packs/`.
 */
