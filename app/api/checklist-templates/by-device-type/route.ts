import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET - Obtener template de checklist por tipo de dispositivo
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const tipoDispositivoId = searchParams.get("tipoDispositivoId")

    let template = null

    // Buscar template específico para el tipo de dispositivo
    if (tipoDispositivoId) {
      const { data: deviceTemplate } = await supabaseAdmin
        .from("checklist_templates")
        .select(`*, checklist_template_items (*)`)
        .eq("organization_id", organizationId!)
        .eq("activo", true)
        .eq("tipo_dispositivo_id", tipoDispositivoId)
        .order("orden", { referencedTable: "checklist_template_items", ascending: true })
        .limit(1)
        .single()

      template = deviceTemplate
    }

    // Fallback: template genérico (sin tipo de dispositivo)
    if (!template) {
      const { data: genericTemplate } = await supabaseAdmin
        .from("checklist_templates")
        .select(`*, checklist_template_items (*)`)
        .eq("organization_id", organizationId!)
        .eq("activo", true)
        .is("tipo_dispositivo_id", null)
        .order("orden", { referencedTable: "checklist_template_items", ascending: true })
        .limit(1)
        .single()

      template = genericTemplate
    }

    // Last fallback: any active template
    if (!template) {
      const { data: anyTemplate } = await supabaseAdmin
        .from("checklist_templates")
        .select(`*, checklist_template_items (*)`)
        .eq("organization_id", organizationId!)
        .eq("activo", true)
        .order("orden", { referencedTable: "checklist_template_items", ascending: true })
        .limit(1)
        .single()

      template = anyTemplate
    }

    if (!template) {
      return NextResponse.json({ template: null })
    }

    // Mapear items
    return NextResponse.json({
      template: {
        id: template.id,
        nombre: template.nombre,
        items: (template.checklist_template_items || []).map((item: any) => ({
          id: item.id,
          label: item.label,
          tipo: item.tipo,
          categoria: item.categoria,
          opciones: item.opciones,
          orden: item.orden,
          requerido: item.requerido,
        })),
      },
    })
  } catch (error) {
    console.error("Error fetching checklist template by device type:", error)
    return NextResponse.json(
      { error: "Error al obtener template" },
      { status: 500 }
    )
  }
}
