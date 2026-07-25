import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  codigo: z.string().min(1).max(40).optional(),
  nombre: z.string().min(1).max(120).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  categoria: z.string().max(80).nullable().optional(),
  precio: z.number().min(0, "El precio no puede ser negativo").optional(),
  duracionEstimadaMin: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
})

function toDTO(s: any) {
  return {
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    descripcion: s.descripcion,
    categoria: s.categoria,
    precio: Number(s.precio),
    duracionEstimadaMin: s.duracion_estimada_min,
    activo: s.activo,
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const parsed = updateSchema.parse(await request.json())

    const updateData: Record<string, any> = {}
    if (parsed.codigo !== undefined) updateData.codigo = parsed.codigo
    if (parsed.nombre !== undefined) updateData.nombre = parsed.nombre
    if (parsed.descripcion !== undefined) updateData.descripcion = parsed.descripcion
    if (parsed.categoria !== undefined) updateData.categoria = parsed.categoria
    if (parsed.precio !== undefined) updateData.precio = parsed.precio
    if (parsed.duracionEstimadaMin !== undefined) {
      updateData.duracion_estimada_min = parsed.duracionEstimadaMin
    }
    if (parsed.activo !== undefined) updateData.activo = parsed.activo

    const { data, error: dbError } = await supabaseAdmin
      .from("servicios")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .select("*")
      .single()

    if (dbError) {
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un servicio con ese código" },
          { status: 400 }
        )
      }
      if (dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Servicio no encontrado" },
          { status: 404 }
        )
      }
      console.error("Error updating servicio:", dbError)
      return NextResponse.json({ error: "Error al actualizar el servicio" }, { status: 500 })
    }

    // Defensivo: con .single() supabase-js siempre setea error.code = PGRST116
    // en cero filas, así que esta rama no debería alcanzarse. Se mantiene
    // como guarda de segundo nivel, no como el único camino a 404.
    if (!data) {
      return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ servicio: toDTO(data) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating servicio:", err)
    return NextResponse.json({ error: "Error al actualizar el servicio" }, { status: 500 })
  }
}

// DELETE - Soft delete. Las líneas ya asignadas a órdenes conservan su snapshot
// de nombre y precio; servicios_orden.servicio_id queda en NULL solo si la fila
// se borrara de verdad, cosa que acá no pasa.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { error: dbError } = await supabaseAdmin
      .from("servicios")
      .update({ deleted_at: new Date().toISOString(), activo: false })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id")
      .single()

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Servicio no encontrado" },
          { status: 404 }
        )
      }
      console.error("Error deleting servicio:", dbError)
      return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting servicio:", err)
    return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
  }
}
