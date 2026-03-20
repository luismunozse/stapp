import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateTemplateSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido").optional(),
  activo: z.boolean().optional(),
  tipoDispositivoId: z.string().optional().nullable(),
})

// GET - Obtener un template específico
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: template, error: dbError } = await supabaseAdmin
      .from("checklist_templates")
      .select(`*, checklist_template_items (*)`)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error("Error fetching checklist template:", error)
    return NextResponse.json(
      { error: "Error al obtener template" },
      { status: 500 }
    )
  }
}

// PUT - Actualizar un template
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = updateTemplateSchema.parse(body)

    // Verificar que el template existe y pertenece a la organización
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id, nombre")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // Si se cambia el nombre, verificar que no exista otro con el mismo nombre
    if (data.nombre && data.nombre !== existing.nombre) {
      const { data: duplicate } = await supabaseAdmin
        .from("checklist_templates")
        .select("id")
        .eq("organization_id", organizationId!)
        .eq("nombre", data.nombre)
        .single()

      if (duplicate) {
        return NextResponse.json(
          { error: "Ya existe un template con ese nombre" },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.activo !== undefined) updateData.activo = data.activo
    if (data.tipoDispositivoId !== undefined) updateData.tipo_dispositivo_id = data.tipoDispositivoId

    const { data: template, error: updateError } = await supabaseAdmin
      .from("checklist_templates")
      .update(updateData)
      .eq("id", id)
      .select(`*, checklist_template_items (*)`)
      .single()

    if (updateError) throw updateError

    return NextResponse.json(template)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating checklist template:", error)
    return NextResponse.json(
      { error: "Error al actualizar template" },
      { status: 500 }
    )
  }
}

// DELETE - Eliminar un template
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Verificar que el template existe y pertenece a la organización
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // Verificar si tiene checklists asociados
    const { count } = await supabaseAdmin
      .from("checklist_recepcion")
      .select("id", { count: "exact", head: true })
      .eq("template_id", id)

    if (count && count > 0) {
      return NextResponse.json(
        { error: `No se puede eliminar: hay ${count} checklist(s) usando este template` },
        { status: 400 }
      )
    }

    await supabaseAdmin.from("checklist_templates").delete().eq("id", id)

    return NextResponse.json({ message: "Template eliminado" })
  } catch (error) {
    console.error("Error deleting checklist template:", error)
    return NextResponse.json(
      { error: "Error al eliminar template" },
      { status: 500 }
    )
  }
}
