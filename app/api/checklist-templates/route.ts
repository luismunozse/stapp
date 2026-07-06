import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const templateSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  activo: z.boolean().optional().default(true),
  tipoDispositivoId: z.string().optional().nullable(),
})

// GET - Obtener todos los templates de la organización
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const tipoDispositivoId = searchParams.get("tipoDispositivoId")

    let query = supabaseAdmin
      .from("checklist_templates")
      .select(`*, checklist_template_items (*), tipos_dispositivo (id, nombre, codigo), checklist_recepcion (count)`)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (tipoDispositivoId) {
      query = query.eq("tipo_dispositivo_id", tipoDispositivoId)
    }

    const { data: templates, error: dbError } = await query

    if (dbError) throw dbError

    // Mapear checklist_template_items a items para el frontend y exponer el
    // conteo de usos (checklist_recepcion) como _count.checklists, que la UI
    // usa para deshabilitar el borrado y mostrar "Usado en N orden(es)".
    const mappedTemplates = templates?.map(t => {
      const { checklist_recepcion, ...rest } = t
      return {
        ...rest,
        items: t.checklist_template_items || [],
        tipoDispositivo: t.tipos_dispositivo || null,
        tipoDispositivoId: t.tipo_dispositivo_id || null,
        _count: { checklists: checklist_recepcion?.[0]?.count ?? 0 },
      }
    }) || []

    return NextResponse.json(mappedTemplates)
  } catch (error) {
    console.error("Error fetching checklist templates:", error)
    return NextResponse.json(
      { error: "Error al obtener templates" },
      { status: 500 }
    )
  }
}

// POST - Crear un nuevo template
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = templateSchema.parse(body)

    const { data: template, error: createError } = await supabaseAdmin
      .from("checklist_templates")
      .insert({
        nombre: data.nombre,
        activo: data.activo,
        organization_id: organizationId!,
        tipo_dispositivo_id: data.tipoDispositivoId || null,
      })
      .select()
      .single()

    if (createError) throw createError

    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating checklist template:", error)
    return NextResponse.json(
      { error: "Error al crear template" },
      { status: 500 }
    )
  }
}
