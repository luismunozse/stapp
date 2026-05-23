import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const itemSchema = z.object({
  itemVentaId: z.string().nullable().optional(),
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().min(1),
  cantidad: z.number().int().positive(),
  precioUnitario: z.number().min(0),
  restock: z.boolean().default(true),
})

const notaCreditoSchema = z.object({
  ventaId: z.string().nullable().optional(),
  ordenId: z.string().nullable().optional(),
  motivo: z.enum(["DEVOLUCION", "AJUSTE_PRECIO", "GARANTIA", "ERROR_FACTURACION", "DESCUENTO_RETRO", "OTRO"]),
  monto: z.number().positive(),
  metodoDevolucion: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "MERCADOPAGO", "CUENTA_CORRIENTE", "NOTA_CREDITO_INTERNA", "OTRO"]).optional().nullable(),
  notas: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
}).refine((d) => !!d.ventaId !== !!d.ordenId, {
  message: "Debe asociarse a venta o orden, no a ambas",
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const ventaId = searchParams.get("ventaId")
    const ordenId = searchParams.get("ordenId")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    let q = supabaseAdmin
      .from("notas_credito")
      .select(`
        id, numero, motivo, monto, metodo_devolucion, fecha, notas,
        venta_id, orden_id, anulada,
        items:items_nota_credito(id, descripcion, cantidad, precio_unitario, restock, inventario_id),
        users:user_id(id, nombre)
      `)
      .eq("organization_id", organizationId!)
      .order("fecha", { ascending: false })

    if (ventaId) q = q.eq("venta_id", ventaId)
    if (ordenId) q = q.eq("orden_id", ordenId)
    if (desde) q = q.gte("fecha", desde)
    if (hasta) q = q.lte("fecha", hasta)

    const { data, error: dbError } = await q
    if (dbError) throw dbError

    return NextResponse.json(
      (data || []).map((n: any) => ({
        id: n.id,
        numero: n.numero,
        motivo: n.motivo,
        monto: parseFloat(n.monto),
        metodoDevolucion: n.metodo_devolucion,
        fecha: n.fecha,
        notas: n.notas,
        ventaId: n.venta_id,
        ordenId: n.orden_id,
        anulada: n.anulada,
        items: (n.items || []).map((i: any) => ({
          id: i.id,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: parseFloat(i.precio_unitario),
          restock: i.restock,
          inventarioId: i.inventario_id,
        })),
        user: n.users ? { id: n.users.id, nombre: n.users.nombre } : null,
      }))
    )
  } catch (err) {
    console.error("Error fetching notas credito:", err)
    return NextResponse.json({ error: "Error al obtener notas de crédito" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = notaCreditoSchema.parse(body)

    // Verificar venta/orden pertenece a org
    if (data.ventaId) {
      const { data: v } = await supabaseAdmin
        .from("ventas").select("id, total").eq("id", data.ventaId).eq("organization_id", organizationId!).single()
      if (!v) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    }
    if (data.ordenId) {
      const { data: o } = await supabaseAdmin
        .from("ordenes_servicio").select("id").eq("id", data.ordenId).eq("organization_id", organizationId!).single()
      if (!o) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("crear_nota_credito", {
      p_org_id: organizationId!,
      p_venta_id: data.ventaId || null,
      p_orden_id: data.ordenId || null,
      p_motivo: data.motivo,
      p_monto: data.monto,
      p_metodo_devolucion: data.metodoDevolucion || null,
      p_notas: data.notas || null,
      p_user_id: userId!,
      p_items: data.items
        ? data.items.map((i) => ({
            item_venta_id: i.itemVentaId || null,
            inventario_id: i.inventarioId || null,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            precio_unitario: i.precioUnitario,
            restock: i.restock,
          }))
        : null,
    })

    if (rpcError) throw rpcError
    if (result?.error) return NextResponse.json({ error: result.error }, { status: 400 })

    return NextResponse.json({ success: true, id: result.id, numero: result.numero }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creando nota credito:", err)
    return NextResponse.json({ error: "Error al crear nota de crédito" }, { status: 500 })
  }
}
