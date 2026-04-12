import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
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
  // Nota: los ids del schema usan cuid, no uuid.
  proveedorId: z.string().min(1).nullable().optional(),
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  puntoReorden: z.number().int().min(0).nullable().optional(),
  barcode: z.string().nullable().optional(),
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
      .select("*, proveedores:proveedor_id(id, nombre)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
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
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = inventarioSchema.parse(body)

    // Verificar que el item pertenece a la organización y no está archivado
    const { data: existingItem, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("id, stock")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
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
    }
    if (data.stock !== undefined) updateData.stock = data.stock
    if (data.precioCompra !== undefined) updateData.precio_compra = data.precioCompra
    if (data.precioVenta !== undefined) updateData.precio_venta = data.precioVenta
    if (data.proveedor !== undefined) updateData.proveedor = data.proveedor
    if (data.proveedorId !== undefined) updateData.proveedor_id = data.proveedorId
    if (data.stockMinimo !== undefined) updateData.stock_minimo = data.stockMinimo
    if (data.stockMaximo !== undefined) updateData.stock_maximo = data.stockMaximo
    if (data.puntoReorden !== undefined) updateData.punto_reorden = data.puntoReorden
    if (data.barcode !== undefined) updateData.barcode = data.barcode

    const { data: item, error: updateError } = await supabaseAdmin
      .from("inventario")
      .update(updateData)
      .eq("id", id)
      .select("*, proveedores:proveedor_id(id, nombre)")
      .single()

    if (updateError) {
      throw updateError
    }

    if (data.stock !== undefined && data.stock !== existingItem.stock) {
      await supabaseAdmin.from('movimientos_inventario').insert({
        inventario_id: id,
        tipo: 'AJUSTE',
        cantidad: data.stock - existingItem.stock,
        stock_anterior: existingItem.stock,
        stock_posterior: data.stock,
        referencia_tipo: 'AJUSTE_MANUAL',
        usuario_id: userId,
        organization_id: organizationId,
      })
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
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Soft-delete: set deleted_at instead of hard delete
    const { data: item, error: updateError } = await supabaseAdmin
      .from("inventario")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .select("id")
      .single()

    if (updateError || !item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error archiving inventario:", error)
    return NextResponse.json(
      { error: "Error al archivar item" },
      { status: 500 }
    )
  }
}
