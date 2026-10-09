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

/** Mensaje unico: un sondeo no distingue "de otra org" de "inexistente". */
const ITEMS_INVALIDOS = "Algún producto de la nota de crédito no es válido"

/**
 * Verifica que los `inventarioId` / `itemVentaId` enviados por el cliente sean de
 * la organizacion (y los `itemVentaId`, de la venta indicada). No filtra
 * `deleted_at`: reponer un producto archivado de la propia org es legitimo.
 * Un error de la query LANZA (500): nunca se permite por defecto.
 */
async function idsDeLaOrganizacion(
  data: z.infer<typeof notaCreditoSchema>,
  organizationId: string
): Promise<boolean> {
  const unicos = (vals: (string | null | undefined)[]) => [...new Set(vals.filter((v): v is string => !!v))]
  const inventarioIds = unicos((data.items ?? []).map((i) => i.inventarioId))
  const itemVentaIds = unicos((data.items ?? []).map((i) => i.itemVentaId))

  if (inventarioIds.length > 0) {
    const { data: rows, error } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .in("id", inventarioIds)
      .eq("organization_id", organizationId)
    if (error) throw error
    if ((rows?.length ?? 0) !== inventarioIds.length) return false
  }

  if (itemVentaIds.length > 0) {
    // items_venta no tiene organization_id: se acota por la venta padre.
    let query = supabaseAdmin
      .from("items_venta")
      .select("id, ventas!inner(organization_id)")
      .in("id", itemVentaIds)
      .eq("ventas.organization_id", organizationId)
    if (data.ventaId) query = query.eq("venta_id", data.ventaId)
    const { data: rows, error } = await query
    if (error) throw error
    if ((rows?.length ?? 0) !== itemVentaIds.length) return false
  }

  return true
}

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

    // Verificar venta/orden pertenece a org (y capturar su sucursal para el egreso)
    let sucursalId: string | null = null
    if (data.ventaId) {
      const { data: v } = await supabaseAdmin
        .from("ventas").select("id, total, sucursal_id").eq("id", data.ventaId).eq("organization_id", organizationId!).single()
      if (!v) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
      sucursalId = (v as any).sucursal_id ?? null
    }
    if (data.ordenId) {
      const { data: o } = await supabaseAdmin
        .from("ordenes_servicio").select("id, sucursal_id").eq("id", data.ordenId).eq("organization_id", organizationId!).single()
      if (!o) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
      sucursalId = (o as any).sucursal_id ?? null
    }

    // La RPC repone stock con `WHERE id = ...` sin filtrar organizacion: los ids
    // del body hay que acotarlos aca, o un ADMIN infla el stock de otra org.
    if (!(await idsDeLaOrganizacion(data, organizationId!))) {
      return NextResponse.json({ error: ITEMS_INVALIDOS }, { status: 400 })
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
