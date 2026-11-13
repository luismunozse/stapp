import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { validarMonedaEscritura } from "@/lib/currency/catalogo"
import { cargarConfigMoneda } from "@/lib/currency/tipo-cambio.server"
import { z } from "zod"

const updateSchema = z.object({
  codigo: z.string().min(1).max(40).optional(),
  nombre: z.string().min(1).max(120).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  categoria: z.string().max(80).nullable().optional(),
  precio: z.number().min(0, "El precio no puede ser negativo").optional(),
  duracionEstimadaMin: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
  // Any string passes the schema: validarMonedaEscritura owns the rule and its message.
  moneda: z.string().nullable().optional(),
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
    moneda: (s.moneda ?? null) as "USD" | "EUR" | null,
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

    // Currency of the price: undefined leaves the column alone and null goes back to local, neither
    // reads anything. Only a foreign currency needs the service's own currency (`actual`) and the config.
    let moneda: "USD" | "EUR" | null | undefined
    if (parsed.moneda === null) moneda = null
    else if (parsed.moneda !== undefined) {
      const { data: existente } = await supabaseAdmin
        .from("servicios")
        .select("moneda")
        .eq("id", id)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .single()
      if (!existente) return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
      const { config } = await cargarConfigMoneda(organizationId!)
      const validacion = validarMonedaEscritura(parsed.moneda, existente.moneda ?? null, config)
      if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 })
      moneda = validacion.moneda
    }

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
    if (moneda !== undefined) updateData.moneda = moneda

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
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 })
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
