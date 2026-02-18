import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { z } from "zod"

const inventarioSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  descripcion: z.string().optional(),
  categoria: z.string().min(1).optional(),
  tipoDispositivo: z.string().min(1).optional(),
  stock: z.number().int().min(0).optional(),
  precioCompra: z.number().min(0).optional(),
  precioVenta: z.number().min(0).optional(),
  proveedor: z.string().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: item, error: dbError } = await supabaseAdmin
      .from("inventario")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(formatInventario(item))
  } catch (error) {
    console.error("Error fetching inventario:", error)
    return NextResponse.json(
      { error: "Error al obtener item" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = inventarioSchema.parse(body)

    // Verificar que el item pertenece a la organización
    const { data: existingItem, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existingItem) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    // Preparar datos para update
    const updateData: Record<string, any> = {}
    if (data.codigo !== undefined) updateData.codigo = data.codigo
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.descripcion !== undefined) updateData.descripcion = data.descripcion
    if (data.categoria !== undefined) updateData.categoria = data.categoria
    if (data.tipoDispositivo !== undefined) {
      updateData.tipo_dispositivo = data.tipoDispositivo
      // Resolver tipo_dispositivo_id
      const { data: tipoDisp } = await supabaseAdmin
        .from("tipos_dispositivo")
        .select("id")
        .eq("organization_id", organizationId!)
        .eq("codigo", data.tipoDispositivo)
        .single()
      updateData.tipo_dispositivo_id = tipoDisp?.id || null
    }
    if (data.stock !== undefined) updateData.stock = data.stock
    if (data.precioCompra !== undefined) updateData.precio_compra = data.precioCompra
    if (data.precioVenta !== undefined) updateData.precio_venta = data.precioVenta
    if (data.proveedor !== undefined) updateData.proveedor = data.proveedor

    const { data: item, error: updateError } = await supabaseAdmin
      .from("inventario")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(formatInventario(item))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating inventario:", error)
    return NextResponse.json(
      { error: "Error al actualizar item" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Verificar que el item pertenece a la organización
    const { data: existingItem, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existingItem) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("inventario")
      .delete()
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting inventario:", error)
    return NextResponse.json(
      { error: "Error al eliminar item" },
      { status: 500 }
    )
  }
}
