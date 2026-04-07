import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  nombre: z.string().min(1).max(80).optional(),
  tipo: z.enum(["FIJO", "VARIABLE"]).optional(),
  afectaRentabilidad: z.boolean().optional(),
  color: z.string().nullable().optional(),
  icono: z.string().nullable().optional(),
  activo: z.boolean().optional(),
})

// PATCH - Actualizar categoría
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.parse(body)

    const updateData: Record<string, any> = {}
    if (parsed.nombre !== undefined) updateData.nombre = parsed.nombre
    if (parsed.tipo !== undefined) updateData.tipo = parsed.tipo
    if (parsed.afectaRentabilidad !== undefined) updateData.afecta_rentabilidad = parsed.afectaRentabilidad
    if (parsed.color !== undefined) updateData.color = parsed.color
    if (parsed.icono !== undefined) updateData.icono = parsed.icono
    if (parsed.activo !== undefined) updateData.activo = parsed.activo

    const { data, error: updateError } = await supabaseAdmin
      .from("categorias_gasto")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe una categoría con ese nombre" },
          { status: 400 }
        )
      }
      console.error("Error updating categoria:", updateError)
      return NextResponse.json({ error: "Error al actualizar categoría" }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 })
    }

    return NextResponse.json({
      categoria: {
        id: data.id,
        nombre: data.nombre,
        tipo: data.tipo,
        afectaRentabilidad: data.afecta_rentabilidad,
        color: data.color,
        icono: data.icono,
        activo: data.activo,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating categoria:", err)
    return NextResponse.json({ error: "Error al actualizar categoría" }, { status: 500 })
  }
}

// DELETE - Soft delete (marca como inactiva)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { error: updateError } = await supabaseAdmin
      .from("categorias_gasto")
      .update({ activo: false })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (updateError) {
      console.error("Error deleting categoria:", updateError)
      return NextResponse.json({ error: "Error al eliminar categoría" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting categoria:", err)
    return NextResponse.json({ error: "Error al eliminar categoría" }, { status: 500 })
  }
}
