import { supabaseAdmin } from "./supabase"

/**
 * Resuelve los campos extras necesarios para dibujar un PDF de cotización
 * a partir de la fila cruda de DB (con equipo_snapshot/checklist_snapshot en JSON).
 *
 * Para el checklist necesitamos hidratar los labels del template, por eso hace
 * un fetch adicional cuando la cotización es tipo PRESUPUESTO con checklist.
 */
export async function buildCotizacionPdfExtras(cotizacion: any) {
  const tipo: "ORDEN" | "PRESUPUESTO" = cotizacion?.tipo === "PRESUPUESTO" ? "PRESUPUESTO" : "ORDEN"

  const equipoRaw = cotizacion?.equipo_snapshot as Record<string, any> | null
  const equipo = tipo === "PRESUPUESTO" && equipoRaw
    ? {
        dispositivo: equipoRaw.dispositivo || "",
        tipoDispositivo: equipoRaw.tipoDispositivo || null,
        marca: equipoRaw.marca || null,
        modelo: equipoRaw.modelo || null,
        color: equipoRaw.color || null,
        imei: equipoRaw.imei || null,
        numeroSerie: equipoRaw.numeroSerie || null,
        problemaReportado: equipoRaw.problemaReportado || "",
      }
    : null

  let checklist: { items: Array<{ label: string; valor: string; categoria?: string | null }>; notas?: string | null } | null = null
  const chkSnap = cotizacion?.checklist_snapshot as Record<string, any> | null

  if (tipo === "PRESUPUESTO" && chkSnap && chkSnap.templateId && chkSnap.valores) {
    // Fetch template para mapear itemId → label/categoria
    const { data: template } = await supabaseAdmin
      .from("checklist_templates")
      .select("id, nombre, checklist_template_items (id, label, categoria, tipo, orden)")
      .eq("id", chkSnap.templateId)
      .single()

    const templateItems: Array<{ id: string; label: string; categoria: string; tipo: string; orden: number }> =
      (template as any)?.checklist_template_items || []

    templateItems.sort((a, b) => (a.orden || 0) - (b.orden || 0))

    const items: Array<{ label: string; valor: string; categoria?: string | null }> = []
    for (const ti of templateItems) {
      const raw = chkSnap.valores[ti.id]
      if (raw === undefined || raw === null || raw === "") continue
      let valor: string
      if (typeof raw === "boolean") valor = raw ? "Sí" : "No"
      else valor = String(raw)
      items.push({ label: ti.label, valor, categoria: ti.categoria })
    }

    if (items.length > 0 || chkSnap.notas) {
      checklist = { items, notas: chkSnap.notas || null }
    }
  }

  return { tipo, equipo, checklist }
}
