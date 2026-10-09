import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { registrarEgresoCajaEfectivo } from "@/lib/caja-utils"
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
  ordenId: z
    .string({
      required_error: "La nota de crédito tiene que ser de una orden",
      invalid_type_error: "La nota de crédito tiene que ser de una orden",
    })
    .min(1, "La nota de crédito tiene que ser de una orden"),
  motivo: z.enum(["DEVOLUCION", "AJUSTE_PRECIO", "GARANTIA", "ERROR_FACTURACION", "DESCUENTO_RETRO", "OTRO"]),
  monto: z.number().positive(),
  metodoDevolucion: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "MERCADOPAGO", "CUENTA_CORRIENTE", "NOTA_CREDITO_INTERNA", "OTRO"]).optional().nullable(),
  notas: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
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
    // Desde la migración 342 esta tabla es solo de órdenes: lo que se acredita
    // sobre una venta es una devolución de la venta (otro motor, otra ruta).
    if (body?.ventaId) {
      return NextResponse.json(
        { error: "Las notas de crédito de una venta se registran como devolución desde la venta" },
        { status: 400 }
      )
    }
    const data = notaCreditoSchema.parse(body)

    // Verificar que la orden pertenece a la org (y capturar su sucursal para el egreso)
    const { data: o } = await supabaseAdmin
      .from("ordenes_servicio").select("id, sucursal_id").eq("id", data.ordenId).eq("organization_id", organizationId!).single()
    if (!o) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    const sucursalId: string | null = (o as any).sucursal_id ?? null

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("crear_nota_credito", {
      p_org_id: organizationId!,
      p_venta_id: null,
      p_orden_id: data.ordenId,
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

    // Nota de crédito reembolsada en efectivo → egreso de caja (arqueo).
    await registrarEgresoCajaEfectivo({
      organizationId: organizationId!,
      userId: userId!,
      sucursalId,
      monto: data.monto,
      metodoPago: data.metodoDevolucion,
      concepto: `Nota de crédito ${result.numero}`,
      observaciones: "Reembolso en efectivo de nota de crédito",
      origen: "NOTA_CREDITO",
    })

    return NextResponse.json({ success: true, id: result.id, numero: result.numero }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creando nota credito:", err)
    return NextResponse.json({ error: "Error al crear nota de crédito" }, { status: 500 })
  }
}
