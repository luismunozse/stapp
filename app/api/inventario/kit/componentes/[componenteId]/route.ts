import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const patchSchema = z.object({
  cantidad: z.number().int().positive().optional(),
  esObligatorio: z.boolean().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  orden: z.number().int().min(0).optional(),
})

// PATCH /api/inventario/kit/componentes/[componenteId]
// Actualiza un row de inventario_kit_items por su ID (no por componente_id).
// El [componenteId] del path es el id del row inventario_kit_items.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ componenteId: string }> }
) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { componenteId: kitItemId } = await params
    const body = await request.json()
    const data = patchSchema.parse(body)

    const update: Record<string, unknown> = {}
    if (data.cantidad !== undefined) update.cantidad = data.cantidad
    if (data.esObligatorio !== undefined) update.es_obligatorio = data.esObligatorio
    if (data.notas !== undefined) update.notas = data.notas
    if (data.orden !== undefined) update.orden = data.orden

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
    }

    const { data: row, error: dbErr } = await supabaseAdmin
      .from("inventario_kit_items")
      .update(update)
      .eq("id", kitItemId)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (dbErr) throw dbErr
    if (!row) {
      return NextResponse.json({ error: "Componente no encontrado" }, { status: 404 })
    }

    return NextResponse.json({
      id: row.id,
      kitId: row.kit_id,
      componenteId: row.componente_id,
      cantidad: row.cantidad,
      esObligatorio: row.es_obligatorio,
      notas: row.notas,
      orden: row.orden,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error actualizando componente kit:", err)
    return NextResponse.json(
      { error: "Error al actualizar componente" },
      { status: 500 }
    )
  }
}

// DELETE /api/inventario/kit/componentes/[componenteId]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ componenteId: string }> }
) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { componenteId: kitItemId } = await params

    const { error: dbErr, count } = await supabaseAdmin
      .from("inventario_kit_items")
      .delete({ count: "exact" })
      .eq("id", kitItemId)
      .eq("organization_id", organizationId!)

    if (dbErr) throw dbErr
    if (count === 0) {
      return NextResponse.json({ error: "Componente no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error eliminando componente kit:", err)
    return NextResponse.json(
      { error: "Error al eliminar componente" },
      { status: 500 }
    )
  }
}
