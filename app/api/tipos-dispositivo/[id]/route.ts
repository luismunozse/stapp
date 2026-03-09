import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  nombre: z.string().min(1).max(50).optional(),
  prefijoOrden: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/)
    .optional(),
  icono: z.string().optional().nullable(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
  config: z.any().optional(),
})

function formatTipoDispositivo(tipo: any) {
  return {
    id: tipo.id,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    prefijoOrden: tipo.prefijo_orden,
    icono: tipo.icono,
    activo: tipo.activo,
    esBase: tipo.es_base,
    orden: tipo.orden,
    config: tipo.config || {},
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: tipo, error: dbError } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !tipo) {
      return NextResponse.json(
        { error: "Tipo de dispositivo no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(formatTipoDispositivo(tipo))
  } catch (error) {
    console.error("Error fetching tipo dispositivo:", error)
    return NextResponse.json(
      { error: "Error al obtener tipo de dispositivo" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "No autorizado. Solo administradores pueden editar tipos." },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateSchema.parse(body)

    // Verificar que el tipo existe y pertenece a la organización
    const { data: tipoExistente } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!tipoExistente) {
      return NextResponse.json(
        { error: "Tipo de dispositivo no encontrado" },
        { status: 404 }
      )
    }

    // Preparar datos para actualización
    const updateData: any = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.prefijoOrden !== undefined) updateData.prefijo_orden = data.prefijoOrden.toUpperCase()
    if (data.icono !== undefined) updateData.icono = data.icono
    if (data.activo !== undefined) updateData.activo = data.activo
    if (data.orden !== undefined) updateData.orden = data.orden
    if (data.config !== undefined) updateData.config = data.config

    const { data: tipo, error: dbError } = await supabaseAdmin
      .from("tipos_dispositivo")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(formatTipoDispositivo(tipo))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating tipo dispositivo:", error)
    return NextResponse.json(
      { error: "Error al actualizar tipo de dispositivo" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "No autorizado. Solo administradores pueden eliminar tipos." },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que el tipo existe y pertenece a la organización
    const { data: tipoExistente } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!tipoExistente) {
      return NextResponse.json(
        { error: "Tipo de dispositivo no encontrado" },
        { status: 404 }
      )
    }

    // Los tipos base no se pueden eliminar, solo desactivar
    if (tipoExistente.es_base) {
      // Soft delete: desactivar en lugar de eliminar
      const { error: dbError } = await supabaseAdmin
        .from("tipos_dispositivo")
        .update({ activo: false })
        .eq("id", id)

      if (dbError) throw dbError

      return NextResponse.json({
        message: "Tipo base desactivado correctamente",
        desactivado: true
      })
    }

    // Verificar si hay órdenes o inventario usando este tipo
    const { count: ordenesCount } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("*", { count: "exact", head: true })
      .eq("tipo_dispositivo_id", id)

    const { count: inventarioCount } = await supabaseAdmin
      .from("inventario")
      .select("*", { count: "exact", head: true })
      .eq("tipo_dispositivo_id", id)

    if ((ordenesCount || 0) > 0 || (inventarioCount || 0) > 0) {
      // Soft delete si está en uso
      const { error: dbError } = await supabaseAdmin
        .from("tipos_dispositivo")
        .update({ activo: false })
        .eq("id", id)

      if (dbError) throw dbError

      return NextResponse.json({
        message: "Tipo desactivado porque está en uso",
        desactivado: true
      })
    }

    // Hard delete si no está en uso
    const { error: dbError } = await supabaseAdmin
      .from("tipos_dispositivo")
      .delete()
      .eq("id", id)

    if (dbError) throw dbError

    return NextResponse.json({ message: "Tipo eliminado correctamente" })
  } catch (error) {
    console.error("Error deleting tipo dispositivo:", error)
    return NextResponse.json(
      { error: "Error al eliminar tipo de dispositivo" },
      { status: 500 }
    )
  }
}
