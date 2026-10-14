import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { registrarEgresoCajaEfectivo } from "@/lib/caja-utils"
import { z } from "zod"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { sucursalParaLectura } from "@/lib/sucursal"
import { dayRangeUtc } from "@/lib/timezone"
import {
  COLUMNAS_VISTA_NC,
  leerFilasNC,
  parseFiltrosListadoNC,
  zonaHorariaDeOrganizacion,
  type FilaVistaNC,
} from "@/lib/notas-credito/listado"

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

/** Mensaje unico: un sondeo no distingue "de otra org" de "inexistente". */
const ITEMS_INVALIDOS = "Algún producto de la nota de crédito no es válido"

/**
 * Verifica que los `inventarioId` / `itemVentaId` enviados por el cliente sean de
 * la organizacion. No filtra
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
    const { data: rows, error } = await supabaseAdmin
      .from("items_venta")
      .select("id, ventas!inner(organization_id)")
      .in("id", itemVentaIds)
      .eq("ventas.organization_id", organizationId)
    if (error) throw error
    if ((rows?.length ?? 0) !== itemVentaIds.length) return false
  }

  return true
}

/**
 * GET /api/notas-credito — listado de las NC de los dos motores
 * (v_notas_credito), con anuladas e historial DEV-.
 *
 * Solo ADMIN hasta el PR7, que abre el listado al VENDEDOR habilitado con su
 * alcance de sucursal y de ventas propias. La sucursal es la que el ADMIN
 * eligió en el selector global (cookie); sin elección, todas.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAdmin()
    if (error) return error

    const filtros = parseFiltrosListadoNC(new URL(request.url).searchParams)
    const offset = (filtros.page - 1) * filtros.limit

    let q = supabaseAdmin
      .from("v_notas_credito")
      .select(COLUMNAS_VISTA_NC, { count: "exact" })
      .eq("organization_id", organizationId!)

    const lectura = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    if (!lectura.verTodas && lectura.sucursalId) q = q.eq("sucursal_id", lectura.sucursalId)

    if (filtros.origen) q = q.eq("origen", filtros.origen)
    if (filtros.modo) q = q.eq("modo", filtros.modo)
    if (filtros.motivo) q = q.eq("motivo_nc", filtros.motivo)
    if (filtros.estado) q = q.eq("anulada", filtros.estado === "ANULADA")
    if (filtros.clienteId) q = q.eq("cliente_id", filtros.clienteId)
    if (filtros.q) q = q.ilike("numero", `%${filtros.q}%`)

    // Días de la organización: "hasta 13/10" incluye la NC de las 22:30 de
    // ese día en Argentina, que en UTC ya es el 14.
    if (filtros.desde || filtros.hasta) {
      const tz = await zonaHorariaDeOrganizacion(organizationId!)
      if (filtros.desde) q = q.gte("fecha", dayRangeUtc(filtros.desde, tz).desde)
      if (filtros.hasta) q = q.lte("fecha", dayRangeUtc(filtros.hasta, tz).hasta)
    }

    const { data, error: dbError, count } = await q
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + filtros.limit - 1)
    if (dbError) throw dbError

    const filas = await leerFilasNC((data ?? []) as unknown as FilaVistaNC[], organizationId!)
    const total = count ?? 0

    return NextResponse.json({
      data: filas,
      total,
      page: filtros.page,
      limit: filtros.limit,
      totalPages: Math.ceil(total / filtros.limit),
    })
  } catch (err) {
    console.error("Error listando notas de credito:", err)
    return NextResponse.json({ error: "Error al obtener notas de crédito" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    // Desde la migración 350 esta tabla es solo de órdenes: lo que se acredita
    // sobre una venta es una devolución de la venta (otro motor, otra ruta).
    if (body?.ventaId) {
      return NextResponse.json(
        { error: "Las notas de crédito de una venta se registran como devolución desde la venta" },
        { status: 400 }
      )
    }
    const data = notaCreditoSchema.parse(body)

    // Las órdenes de práctica del onboarding no admiten notas de crédito
    const practica = await rejectIfPractica(data.ordenId, organizationId!)
    if (practica) return practica

    // Verificar que la orden pertenece a la org (y capturar su sucursal para el egreso)
    const { data: o } = await supabaseAdmin
      .from("ordenes_servicio").select("id, sucursal_id").eq("id", data.ordenId).eq("organization_id", organizationId!).single()
    if (!o) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    const sucursalId: string | null = (o as any).sucursal_id ?? null

    // La RPC repone stock con `WHERE id = ...` sin filtrar organizacion: los ids
    // del body hay que acotarlos aca, o un ADMIN infla el stock de otra org.
    if (!(await idsDeLaOrganizacion(data, organizationId!))) {
      return NextResponse.json({ error: ITEMS_INVALIDOS }, { status: 400 })
    }

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
