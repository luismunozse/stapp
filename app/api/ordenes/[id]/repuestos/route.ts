import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// Schema para repuesto de inventario
const repuestoInventarioSchema = z.object({
  tipo: z.literal("inventario"),
  inventarioId: z.string().min(1),
  cantidad: z.number().int().min(1),
})

// Schema para repuesto manual
const repuestoManualSchema = z.object({
  tipo: z.literal("manual"),
  nombre: z.string().min(1, "El nombre es requerido"),
  cantidad: z.number().int().min(1),
  precioUnitario: z.number().min(0, "El precio debe ser mayor o igual a 0"),
})

// Schema combinado
const repuestoSchema = z.discriminatedUnion("tipo", [
  repuestoInventarioSchema,
  repuestoManualSchema,
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const body = await request.json()
    const data = repuestoSchema.parse(body)

    // Verificar que la orden pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    if (data.tipo === "inventario") {
      // Repuesto desde inventario
      const { data: item, error: itemError } = await supabaseAdmin
        .from("inventario")
        .select("id, stock, precio_venta")
        .eq("id", data.inventarioId)
        .eq("organization_id", organizationId!)
        .single()

      if (itemError || !item) {
        return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
      }

      if (item.stock < data.cantidad) {
        return NextResponse.json({ error: "Stock insuficiente" }, { status: 400 })
      }

      // Crear relación repuesto-orden
      await supabaseAdmin.from("repuestos_orden").insert({
        orden_id: ordenId,
        inventario_id: data.inventarioId,
        cantidad: data.cantidad,
        precio_unitario: item.precio_venta,
      })

      // Actualizar stock
      await supabaseAdmin
        .from("inventario")
        .update({ stock: item.stock - data.cantidad })
        .eq("id", data.inventarioId)
    } else {
      // Repuesto manual (sin inventario)
      await supabaseAdmin.from("repuestos_orden").insert({
        orden_id: ordenId,
        nombre: data.nombre,
        cantidad: data.cantidad,
        precio_unitario: data.precioUnitario,
      })
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error adding repuesto:", error)
    return NextResponse.json(
      { error: "Error al agregar repuesto" },
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

    const { id: ordenId } = await params
    const { searchParams } = new URL(request.url)
    const repuestoId = searchParams.get("repuestoId")

    if (!repuestoId) {
      return NextResponse.json({ error: "ID de repuesto requerido" }, { status: 400 })
    }

    // Verificar que la orden pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Obtener el repuesto
    const { data: repuesto, error: repuestoError } = await supabaseAdmin
      .from("repuestos_orden")
      .select("id, orden_id, inventario_id, cantidad")
      .eq("id", repuestoId)
      .single()

    if (repuestoError || !repuesto || repuesto.orden_id !== ordenId) {
      return NextResponse.json({ error: "Repuesto no encontrado" }, { status: 404 })
    }

    // Eliminar repuesto
    await supabaseAdmin.from("repuestos_orden").delete().eq("id", repuestoId)

    // Devolver stock solo si era de inventario
    if (repuesto.inventario_id) {
      const { data: item } = await supabaseAdmin
        .from("inventario")
        .select("stock")
        .eq("id", repuesto.inventario_id)
        .single()

      if (item) {
        await supabaseAdmin
          .from("inventario")
          .update({ stock: item.stock + repuesto.cantidad })
          .eq("id", repuesto.inventario_id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error removing repuesto:", error)
    return NextResponse.json(
      { error: "Error al eliminar repuesto" },
      { status: 500 }
    )
  }
}
