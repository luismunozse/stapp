import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatDevolucion } from "@/lib/db-utils"
import { getNextReturnNumber } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { sucursalParaLectura } from "@/lib/sucursal"
import { aggregateReturnItems } from "@/lib/devolucion-refund"
import { registrarEgresoCajaEfectivo } from "@/lib/caja-utils"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { z } from "zod"

const itemDevolucionSchema = z.object({
  itemVentaId: z.string().min(1, "El ID del item de venta es requerido"),
  // Se ignora: el producto a reponer sale del item vendido (mig 330). Se
  // acepta por compatibilidad con clientes viejos.
  inventarioId: z.string().nullable().optional(),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().min(0, "El precio unitario debe ser mayor o igual a 0"),
  restaurarStock: z.boolean(),
})

const devolucionSchema = z.object({
  motivo: z.string().min(1, "El motivo es requerido"),
  observaciones: z.string().optional(),
  items: z.array(itemDevolucionSchema).min(1, "Debe incluir al menos un item"),
  metodoReembolso: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CREDITO_TIENDA", "CUENTA_CORRIENTE", "OTRO"]).optional(),
  reembolsoReferencia: z.string().optional(),
  idempotencyKey: z.string().max(100).optional(),
})

type ResultadoDevolucion = {
  id: string
  tipo: string
  montoDevolucion: number
  /** Desde la mig 330: parte que descontó el saldo pendiente de la venta. */
  montoAplicadoDeuda?: number
  /** Desde la mig 330: lo que efectivamente se devuelve al cliente. */
  montoReembolso?: number
  replayed?: boolean
}

// La RPC no está en la base (migración sin aplicar o caché de PostgREST
// desactualizada). No hay camino alternativo: se responde 503.
function isFunctionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}

// GET: Get all returns for a sale
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requirePosAccess()
    if (error) return error

    const { id } = await params

    const filtro = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })

    // Verify the sale belongs to the organization
    let ventaQuery = supabaseAdmin.from("ventas").select("id").eq("id", id).eq("organization_id", organizationId!)
    if (!filtro.verTodas && filtro.sucursalId) {
      ventaQuery = ventaQuery.eq("sucursal_id", filtro.sucursalId)
    }
    // Igual que el detalle de la venta: el vendedor solo ve las suyas
    if (soloVeSusVentas(role)) {
      ventaQuery = ventaQuery.eq("vendedor_id", userId!)
    }
    const { data: venta, error: ventaError } = await ventaQuery.single()

    if (ventaError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    // Fetch devoluciones with items
    const { data: devoluciones, error: dbError } = await supabaseAdmin
      .from("devoluciones_venta")
      .select("*, items_devolucion (*)")
      .eq("venta_id", id)
      .order("created_at", { ascending: false })

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(
      (devoluciones || []).map(formatDevolucion)
    )
  } catch (error) {
    console.error("Error fetching devoluciones:", error)
    return NextResponse.json(
      { error: "Error al obtener devoluciones" },
      { status: 500 }
    )
  }
}

// POST: Create a return (only ADMIN)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requirePosAccess()
    if (error) return error

    // Only ADMIN can create returns
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden crear devoluciones" },
        { status: 403 }
      )
    }

    const { id } = await params

    const filtroP = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })
    let ventaCheckQuery = supabaseAdmin.from("ventas").select("id, sucursal_id, cliente_id").eq("id", id).eq("organization_id", organizationId!)
    if (!filtroP.verTodas && filtroP.sucursalId) {
      ventaCheckQuery = ventaCheckQuery.eq("sucursal_id", filtroP.sucursalId)
    }
    const { data: ventaCheck, error: ventaCheckError } = await ventaCheckQuery.single()
    if (ventaCheckError || !ventaCheck) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    }

    const body = await request.json()
    const data = devolucionSchema.parse(body)

    // "Crédito en tienda" es saldo a favor en la cuenta corriente del cliente.
    // Antes no movía nada: el crédito no quedaba registrado en ningún lado.
    if (data.metodoReembolso === "CREDITO_TIENDA") data.metodoReembolso = "CUENTA_CORRIENTE"
    if (data.metodoReembolso === "CUENTA_CORRIENTE" && !(ventaCheck as any).cliente_id) {
      return NextResponse.json(
        { error: "Para devolver a cuenta corriente la venta tiene que tener un cliente" },
        { status: 400 }
      )
    }

    // Agregar líneas con el mismo itemVentaId: sin esto, entradas duplicadas
    // pasan cada una la validación de máximo devolvible por separado y permiten
    // devolver (y reembolsar) más de lo vendido.
    data.items = aggregateReturnItems(data.items)

    // Número de devolución antes de llamar a la RPC
    const numeroDevolucion = await getNextReturnNumber(organizationId!)

    // RPC atómica (migración 247; saldo pendiente e idempotencia: 330)
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("registrar_devolucion_atomica", {
      p_org_id: organizationId!,
      p_venta_id: id,
      p_user_id: userId!,
      p_numero_devolucion: numeroDevolucion,
      p_motivo: data.motivo,
      p_observaciones: data.observaciones ?? null,
      p_metodo_reembolso: data.metodoReembolso ?? null,
      p_reembolso_referencia: data.reembolsoReferencia ?? null,
      p_items: data.items.map((i) => ({
        itemVentaId: i.itemVentaId,
        inventarioId: i.inventarioId ?? null,
        cantidad: i.cantidad,
        restaurarStock: i.restaurarStock,
      })),
      p_idempotency_key: data.idempotencyKey ?? null,
    })

    if (rpcError) {
      // Sin la RPC no hay devolución posible. El fallback JS que había acá
      // acreditaba el monto entero a cuenta corriente, sin descontar el saldo
      // pendiente de la venta (lo que la 330 corrigió en la RPC).
      if (isFunctionMissingError(rpcError)) {
        console.error("registrar_devolucion_atomica no disponible:", rpcError)
        return NextResponse.json(
          { error: "Las devoluciones no están disponibles en este momento" },
          { status: 503 }
        )
      }

      // Map domain errors raised by the RPC
      const msg = rpcError.message ?? ""
      if (msg.includes("no encontrada")) {
        return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
      }
      if (msg.includes("completadas")) {
        return NextResponse.json(
          { error: "Solo se pueden crear devoluciones para ventas completadas" },
          { status: 400 }
        )
      }
      if (msg.includes("excede lo permitido") || msg.includes("no encontrado") || msg.includes("tiene que tener un cliente")) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }

      throw rpcError
    }

    // RPC succeeded
    const resultado = rpcData as ResultadoDevolucion
    const devolucionId = resultado.id

    // Fetch the full record in the same shape the route has always returned
    const { data: devolucionCompleta } = await supabaseAdmin
      .from("devoluciones_venta")
      .select("*, items_devolucion (*)")
      .eq("id", devolucionId)
      .single()

    // Reintento del mismo pedido: ya se registró (y se auditó y se sacó la
    // plata de la caja) la primera vez.
    if (resultado.replayed) {
      return NextResponse.json(formatDevolucion(devolucionCompleta), { status: 200 })
    }

    // Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("devoluciones_venta", devolucionId, {
      numero_devolucion: numeroDevolucion,
      venta_id: id,
      tipo: resultado.tipo,
      monto_devolucion: resultado.montoDevolucion,
      monto_aplicado_deuda: resultado.montoAplicadoDeuda ?? 0,
      items_count: data.items.length,
    })

    emitWebhookEvent(organizationId!, "venta.devolucion", {
      id: devolucionId,
      ventaId: id,
      numeroDevolucion,
      tipo: resultado.tipo,
      montoDevolucion: resultado.montoDevolucion,
      montoAplicadoDeuda: resultado.montoAplicadoDeuda ?? 0,
      metodoReembolso: data.metodoReembolso ?? null,
    }).catch(() => {})

    // Reembolso en efectivo → egreso de caja (para que el arqueo cuadre). Solo
    // lo que se devuelve: la parte que descontó el saldo pendiente nunca entró.
    await registrarEgresoCajaEfectivo({
      organizationId: organizationId!,
      userId: userId!,
      sucursalId: (ventaCheck as any).sucursal_id ?? null,
      monto: resultado.montoReembolso ?? resultado.montoDevolucion,
      metodoPago: data.metodoReembolso,
      concepto: `Devolución ${numeroDevolucion}`,
      observaciones: "Reembolso en efectivo de devolución de venta",
      origen: "DEVOLUCION",
    })

    return NextResponse.json(formatDevolucion(devolucionCompleta), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating devolucion:", error)
    return NextResponse.json(
      { error: "Error al crear devolución" },
      { status: 500 }
    )
  }
}
