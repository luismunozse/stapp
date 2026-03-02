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
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Rajaduras,Rota", orden: 1, requerido: true },
      { label: "Estado de carcasa/tapa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Rota", orden: 2, requerido: true },
      { label: "Botones funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: true },
      { label: "Altavoz funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: false },
      { label: "Micrófono funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: false },
      { label: "Cámara funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
      { label: "Touch ID / Face ID funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: false },
      { label: "Cargador incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 8, requerido: true },
      { label: "Funda incluida", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 9, requerido: false },
      { label: "Tarjeta SIM incluida", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 10, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 11, requerido: false },
    ],
  },
  {
    nombre: "Recepción Notebook/PC",
    tipoDispositivo: "COMPUTADORA",
    items: [
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Pixeles muertos,Rota", orden: 1, requerido: true },
      { label: "Estado de teclado", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Funcional,Teclas faltantes,No funciona", orden: 2, requerido: true },
      { label: "Touchpad funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: true },
      { label: "Estado de bisagras", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Firmes,Flojas,Rotas", orden: 4, requerido: true },
      { label: "Puertos USB funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: false },
      { label: "WiFi funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
      { label: "Cargador incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 7, requerido: true },
      { label: "Batería presente", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 8, requerido: true },
      { label: "Contraseña de sesión", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 9, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 10, requerido: false },
    ],
  },
  {
    nombre: "Recepción Consola",
    tipoDispositivo: "CONSOLA",
    items: [
      { label: "Estado de carcasa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura,Rota", orden: 1, requerido: true },
      { label: "Controles incluidos", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 2, requerido: true },
      { label: "Cantidad de controles", tipo: "TEXT", categoria: "ACCESORIOS", opciones: null, orden: 3, requerido: false },
      { label: "Cable HDMI incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 4, requerido: false },
      { label: "Cable de alimentación incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 5, requerido: true },
      { label: "Lectora de disco funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
      { label: "Enciende correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: true },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 8, requerido: false },
    ],
  },
  {
    nombre: "Recepción Tablet",
    tipoDispositivo: "TABLET",
    items: [
      { label: "Estado de pantalla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Rajaduras,Rota", orden: 1, requerido: true },
      { label: "Estado de carcasa", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abolladura", orden: 2, requerido: true },
      { label: "Botones funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: true },
      { label: "Carga correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
      { label: "Cargador incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 5, requerido: true },
      { label: "Funda/cover incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 6, requerido: false },
      { label: "Lápiz/stylus incluido", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 7, requerido: false },
      { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 8, requerido: false },
    ],
  },
]

/**
 * Instala los checklist presets en una organización
 */
export async function installChecklistPresets(
  organizationId: string,
  supabaseAdmin: any
): Promise<string[]> {
  const createdIds: string[] = []

  for (const preset of CHECKLIST_PRESETS) {
    // Crear template
    const { data: template } = await supabaseAdmin
      .from("checklist_templates")
      .insert({
        organization_id: organizationId,
        nombre: preset.nombre,
        activo: true,
      })
      .select("id")
      .single()

    if (!template) continue
    createdIds.push(template.id)

    // Crear items
    const items = preset.items.map((item) => ({
      template_id: template.id,
      ...item,
    }))

    await supabaseAdmin
      .from("checklist_template_items")
      .insert(items)
  }

  return createdIds
}
