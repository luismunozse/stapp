import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatDevolucion } from "@/lib/db-utils"
import { createAuditLogger } from "@/lib/audit"
import { sucursalParaLectura } from "@/lib/sucursal"
import { aggregateReturnItems } from "@/lib/devolucion-refund"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { MOTIVOS_NC_VENTA, MOTIVO_NC_LABELS } from "@/lib/notas-credito/catalogo"
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

const devolucionSchema = z
  .object({
    // Sin modo: cliente anterior al PR3 (el formulario viejo), devolución de productos.
    modo: z.enum(["ITEMS", "MONTO"]).default("ITEMS"),
    // Motivo del catálogo (mig 350). Obligatorio por monto; los clientes anteriores no lo mandan.
    motivoNc: z
      .enum(MOTIVOS_NC_VENTA, { errorMap: () => ({ message: "Motivo de nota de crédito inválido" }) })
      .optional(),
    // Detalle libre. Para los clientes anteriores es el único motivo.
    motivo: z.string().trim().max(500).optional(),
    observaciones: z.string().optional(),
    items: z.array(itemDevolucionSchema).optional(),
    monto: z.number().finite().optional(),
    metodoReembolso: z
      .enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CREDITO_TIENDA", "CUENTA_CORRIENTE", "OTRO"])
      .optional(),
    reembolsoReferencia: z.string().optional(),
    idempotencyKey: z.string().max(100).optional(),
  })
  .superRefine((d, ctx) => {
    const falta = (message: string, campo: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [campo] })
    if (d.modo === "ITEMS") {
      if (!d.motivo && !d.motivoNc) falta("El motivo es requerido", "motivo")
      if (!d.items || d.items.length === 0) falta("Debe incluir al menos un item", "items")
      return
    }
    if (!d.motivoNc) falta("El motivo es requerido", "motivoNc")
    if (d.monto === undefined || Math.round(d.monto * 100) <= 0) {
      falta("El monto tiene que ser mayor a cero", "monto")
    }
    if (d.items && d.items.length > 0) falta("Una nota de crédito por monto no lleva productos", "items")
  })

type ResultadoDevolucion = {
  id: string
  /** Desde la mig 356: el NC- que la RPC asignó adentro de su transacción. */
  numero: string
  /** Desde la mig 365. */
  modo?: "ITEMS" | "MONTO"
  tipo: string
  montoDevolucion: number
  /** Desde la mig 330: parte que descontó el saldo pendiente de la venta. */
  montoAplicadoDeuda?: number
  /** Desde la mig 330: lo que efectivamente se devuelve al cliente. */
  montoReembolso?: number
  /** Desde la mig 365: el egreso de caja del reintegro en efectivo, si hubo. */
  movimientoCajaId?: string | null
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

// Errores de negocio que levanta la RPC (migs 330, 356 y 365). El texto se
// devuelve tal cual: la base lo escribe para el taller.
const ERRORES_409 = ["supera lo disponible", "no tiene saldo para acreditar", "clave de reintento"]
const ERRORES_400 = [
  "excede lo permitido",
  "no encontrado",
  "tiene que tener un cliente",
  "Falta el medio de reintegro",
  "motivo de la nota de crédito",
  "mayor a cero",
  "al menos un producto",
]

function errorDeNegocio(msg: string): NextResponse | null {
  if (msg.includes("no encontrada")) {
    return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
  }
  if (msg.includes("completadas")) {
    return NextResponse.json(
      { error: "Solo se pueden crear devoluciones para ventas completadas" },
      { status: 400 }
    )
  }
  if (ERRORES_409.some((f) => msg.includes(f))) return NextResponse.json({ error: msg }, { status: 409 })
  if (ERRORES_400.some((f) => msg.includes(f))) return NextResponse.json({ error: msg }, { status: 400 })
  return null
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

// POST: emitir una nota de crédito sobre la venta, devolviendo productos o
// por monto (solo ADMIN hasta el PR7)
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
    const items = data.modo === "ITEMS" ? aggregateReturnItems(data.items ?? []) : []
    // La columna motivo es NOT NULL: sin detalle, la etiqueta del motivo del catálogo.
    const motivoTexto = data.motivo || (data.motivoNc ? MOTIVO_NC_LABELS[data.motivoNc] : "")

    // RPC atómica (247; saldo pendiente e idempotencia: 330; número: 356; modo y caja: 365)
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("registrar_devolucion_atomica", {
      p_org_id: organizationId!,
      p_venta_id: id,
      p_user_id: userId!,
      // El NC- lo asigna la RPC adentro de su transacción (mig 356): si la
      // devolución falla, el número no se quema.
      p_numero_devolucion: null,
      p_motivo: motivoTexto,
      p_observaciones: data.observaciones ?? null,
      p_metodo_reembolso: data.metodoReembolso ?? null,
      p_reembolso_referencia: data.reembolsoReferencia ?? null,
      p_items: items.map((i) => ({
        itemVentaId: i.itemVentaId,
        inventarioId: i.inventarioId ?? null,
        cantidad: i.cantidad,
        restaurarStock: i.restaurarStock,
      })),
      p_idempotency_key: data.idempotencyKey ?? null,
      p_modo: data.modo,
      p_monto: data.modo === "MONTO" ? Math.round(data.monto! * 100) / 100 : null,
      p_motivo_nc: data.motivoNc ?? null,
      // El efectivo sale de la caja adentro de la RPC, en la misma transacción
      // que la NC (mig 365). Antes lo grababa esta ruta después, best-effort.
      p_registrar_egreso: true,
    })

    if (rpcError) {
      // Sin la RPC no hay devolución posible: se responde 503.
      if (isFunctionMissingError(rpcError)) {
        console.error("registrar_devolucion_atomica no disponible:", rpcError)
        return NextResponse.json(
          { error: "Las devoluciones no están disponibles en este momento" },
          { status: 503 }
        )
      }
      const respuesta = errorDeNegocio(rpcError.message ?? "")
      if (respuesta) return respuesta
      throw rpcError
    }

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

    const modo = resultado.modo ?? data.modo
    const montoAplicadoDeuda = resultado.montoAplicadoDeuda ?? 0
    const montoReembolso = resultado.montoReembolso ?? resultado.montoDevolucion - montoAplicadoDeuda
    // Sin reintegro la base no guarda medio (mig 365): el aviso tampoco lo inventa.
    const metodoReembolso = montoReembolso > 0 ? (data.metodoReembolso ?? null) : null

    // Auditoría: una NC, sea del motor que sea (spec, Plataforma)
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("notas_credito", devolucionId, {
      origen: "VENTA",
      numero: resultado.numero,
      venta_id: id,
      modo,
      motivo_nc: data.motivoNc ?? null,
      tipo: resultado.tipo,
      monto: resultado.montoDevolucion,
      monto_aplicado_deuda: montoAplicadoDeuda,
      monto_reembolso: montoReembolso,
      metodo_reembolso: metodoReembolso,
      items_count: items.length,
      egreso_caja_id: resultado.movimientoCajaId ?? null,
    })

    emitWebhookEvent(organizationId!, "nota_credito.creada", {
      id: devolucionId,
      numero: resultado.numero,
      origen: "VENTA",
      origenId: id,
      modo,
      motivoNc: data.motivoNc ?? null,
      monto: resultado.montoDevolucion,
      montoAplicadoDeuda,
      montoReembolso,
      metodoReembolso,
    }).catch(() => {})

    // El evento de siempre, para quien ya lo consume (spec: se sigue emitiendo)
    emitWebhookEvent(organizationId!, "venta.devolucion", {
      id: devolucionId,
      ventaId: id,
      numeroDevolucion: resultado.numero,
      tipo: resultado.tipo,
      montoDevolucion: resultado.montoDevolucion,
      montoAplicadoDeuda,
      metodoReembolso,
      modo,
    }).catch(() => {})

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
