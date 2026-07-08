import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { z } from "zod"

const pagoLineSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodo: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]),
  referencia: z.string().nullable().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargo: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  costoFinanciero: z.number().min(0).nullable().optional(),
})

// Supports both legacy single payment and new multi-payment
const pagoVentaSchema = z.object({
  // Multi-payment (new)
  pagos: z.array(pagoLineSchema).optional(),
  // Legacy single payment (backwards compat)
  monto: z.number().positive().optional(),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]).optional(),
  numeroReferencia: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  observaciones: z.string().optional(),
  clienteId: z.string().optional(),
  // Request-level idempotency key: one stable UUID per submit attempt.
  // Offline retries reuse the same key so the barrier dedupes instead of
  // running the payment mutations twice.
  idempotencyKey: z.string().max(100).nullable().optional(),
})

function calcularEstadoPago(montoAbonado: number, total: number): string {
  if (montoAbonado <= 0) return "PENDIENTE"
  if (montoAbonado >= total) return "PAGADO"
  return "PAGADO_PARCIAL"
}

// Returns true when the error indicates the pago_idempotency table does not
// exist yet (migration 233 not applied). In that case the barrier is skipped
// and the endpoint behaves exactly as before the migration.
function isTableMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  // PostgREST schema-cache miss: PGRST205
  // PostgreSQL undefined_table: 42P01
  // PostgREST "does not exist" or "schema cache" messages
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}

// Returns true when the RPC error indicates migration 237 has not been applied yet
// (the function registrar_pagos_venta_atomica does not exist in the DB).
// In that case we fall back to the JS implementation so the endpoint keeps
// working before the migration is deployed.
function isFunctionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  // PostgREST: function overload not found
  // PostgreSQL: undefined_function (42883)
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden registrar pagos" },
        { status: 403 }
      )
    }

    const { id: ventaId } = await params
    const body = await request.json()
    const data = pagoVentaSchema.parse(body)

    // Normalize: convert legacy single payment to array
    let pagosToProcess: z.infer<typeof pagoLineSchema>[]
    if (data.pagos && data.pagos.length > 0) {
      pagosToProcess = data.pagos
    } else if (data.monto && data.metodoPago) {
      pagosToProcess = [{
        monto: data.monto,
        metodo: data.metodoPago,
        referencia: data.numeroReferencia || null,
        cuotas: data.cuotas || null,
        recargo: data.recargoPorcentaje || null,
        montoOriginal: data.montoOriginal || null,
      }]
    } else {
      return NextResponse.json({ error: "Debe enviar al menos un pago" }, { status: 400 })
    }

    // Obtener venta y verificar org
    const filtro = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })
    let ventaQuery = supabaseAdmin.from("ventas").select("*").eq("id", ventaId).eq("organization_id", organizationId!)
    if (!filtro.verTodas && filtro.sucursalId) {
      ventaQuery = ventaQuery.eq("sucursal_id", filtro.sucursalId)
    }
    const { data: venta, error: fetchError } = await ventaQuery.single()

    if (fetchError || !venta) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    }

    if (venta.estado === "ANULADA") {
      return NextResponse.json(
        { error: "No se pueden registrar pagos en una venta anulada" },
        { status: 400 }
      )
    }

    // Validar que no se pague más del pendiente
    const pendiente = parseFloat(venta.total) - parseFloat(venta.monto_abonado || "0")
    const totalPagos = pagosToProcess.reduce((sum, p) => sum + p.monto, 0)
    if (totalPagos > pendiente + 0.01) {
      return NextResponse.json(
        { error: `El monto total (${totalPagos.toFixed(2)}) excede el pendiente (${pendiente.toFixed(2)})` },
        { status: 400 }
      )
    }

    // --- Atomic RPC path (migration 237) ---
    // Maps each pago line to the RPC's expected field names.
    const pagosRpc = pagosToProcess.map(p => ({
      monto: p.monto,
      metodo: p.metodo,
      referencia: p.referencia ?? null,
      cuotas: p.cuotas ?? null,
      recargo: p.recargo ?? null,
      montoOriginal: p.montoOriginal ?? null,
      costoFinanciero: p.costoFinanciero ?? null,
    }))

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "registrar_pagos_venta_atomica",
      {
        p_org_id: organizationId!,
        p_venta_id: ventaId,
        p_usuario_id: userId!,
        p_cliente_id: data.clienteId ?? null,
        p_observaciones: data.observaciones ?? null,
        p_pagos: pagosRpc,
        p_idempotency_key: data.idempotencyKey ?? null,
      }
    )

    if (!rpcError) {
      // RPC succeeded
      const result = rpcResult as { replayed: boolean; response: unknown }
      return NextResponse.json(result.response, { status: result.replayed ? 200 : 201 })
    }

    // RPC function not deployed yet → fall back to JS implementation
    if (isFunctionMissingError(rpcError)) {
      console.warn("[pagos] registrar_pagos_venta_atomica not found; falling back to JS path")
      return await runJsFallback({
        organizationId: organizationId!,
        userId: userId!,
        ventaId,
        venta,
        data,
        pagosToProcess,
        totalPagos,
        pendiente,
      })
    }

    // Known business-rule errors from the RPC's RAISE EXCEPTION
    const msg = rpcError.message ?? ""
    if (msg.includes("no encontrada")) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    }
    if (
      msg.includes("anulada") ||
      msg.includes("excede el pendiente") ||
      msg.toLowerCase().includes("saldo insuficiente")
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    console.error("[pagos] Unexpected RPC error:", rpcError)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating pago venta:", error)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// JS fallback — identical logic to the original handler, preserved for
// deploy-safety while migration 237 is not yet applied.
// ---------------------------------------------------------------------------
async function runJsFallback(opts: {
  organizationId: string
  userId: string
  ventaId: string
  venta: any
  data: z.infer<typeof pagoVentaSchema>
  pagosToProcess: z.infer<typeof pagoLineSchema>[]
  totalPagos: number
  pendiente: number
}): Promise<NextResponse> {
  const { organizationId, userId, ventaId, venta, data, pagosToProcess, totalPagos } = opts

  // --- Idempotency barrier (migration 233) ---
  const key = data.idempotencyKey || null
  let claimed = false
  let barrierAvailable = true

  if (key) {
    const { error: insertError } = await supabaseAdmin
      .from("pago_idempotency")
      .insert({
        organization_id: organizationId,
        idempotency_key: key,
        venta_id: ventaId,
      })

    if (insertError) {
      if (isTableMissingError(insertError)) {
        console.warn("[pagos] pago_idempotency table unavailable; running without idempotency barrier")
        barrierAvailable = false
      } else if ((insertError as any).code === "23505") {
        const { data: existing } = await supabaseAdmin
          .from("pago_idempotency")
          .select("response")
          .eq("organization_id", organizationId)
          .eq("idempotency_key", key)
          .maybeSingle()

        if (existing?.response) {
          return NextResponse.json(existing.response, { status: 200 })
        }
        return NextResponse.json(
          { error: "Pago en proceso, reintentá en unos segundos" },
          { status: 409 }
        )
      } else {
        console.warn("[pagos] Unexpected error claiming idempotency row; proceeding without barrier", insertError)
        barrierAvailable = false
      }
    } else {
      claimed = true
    }
  }

  const clienteId = data.clienteId || venta.cliente_id
  const pagosCreados: any[] = []

  // success flag: set to true immediately before the success return so the
  // finally block knows whether to clean up the idempotency poison row.
  let success = false

  try {
    for (const pagoLine of pagosToProcess) {
      if (pagoLine.metodo === "CUENTA_CORRIENTE" && clienteId) {
        const { error: ccError } = await supabaseAdmin.rpc("usar_cuenta_corriente", {
          p_org_id: organizationId,
          p_cliente_id: clienteId,
          p_monto: pagoLine.monto,
          p_referencia_tipo: "VENTA",
          p_referencia_id: ventaId,
          p_usuario_id: userId,
          // Derived from the venta's own sucursal_id (single source of truth for
          // where this transaction happened), not the current operator's active
          // cookie — mirrors crear_nota_credito's "derive from parent" pattern.
          p_sucursal_id: venta.sucursal_id ?? null,
        })
        if (ccError) {
          // CC error: early return — success stays false → finally deletes poison row
          return NextResponse.json(
            { error: ccError.message || "Error al usar cuenta corriente" },
            { status: 400 }
          )
        }
      }

      const cfPorcentaje = pagoLine.costoFinanciero || null
      const cfMonto = cfPorcentaje && cfPorcentaje > 0
        ? Math.round(pagoLine.monto * (cfPorcentaje / 100) * 100) / 100
        : null

      const { data: pago, error: pagoError } = await supabaseAdmin
        .from("pagos_venta")
        .insert({
          venta_id: ventaId,
          monto: pagoLine.monto,
          metodo_pago: pagoLine.metodo,
          numero_referencia: pagoLine.referencia || null,
          observaciones: data.observaciones || null,
          cuotas: pagoLine.cuotas || null,
          recargo_porcentaje: pagoLine.recargo || null,
          monto_original: pagoLine.montoOriginal || null,
          costo_financiero_porcentaje: cfPorcentaje,
          costo_financiero_monto: cfMonto,
        })
        .select()
        .single()

      if (pagoError) throw pagoError
      pagosCreados.push(pago)
    }

    // Reconciliar fiado
    if (clienteId) {
      const totalExterno = pagosToProcess
        .filter((p) => p.metodo !== "CUENTA_CORRIENTE")
        .reduce((sum, p) => sum + p.monto, 0)
      if (totalExterno > 0) {
        const { error: pagoFiadoError } = await supabaseAdmin.rpc("pagar_fiado_cuenta_corriente", {
          p_org_id: organizationId,
          p_cliente_id: clienteId,
          p_monto: totalExterno,
          p_referencia_tipo: "VENTA",
          p_referencia_id: ventaId,
          p_usuario_id: userId,
          p_sucursal_id: venta.sucursal_id ?? null,
        })
        if (pagoFiadoError) {
          console.error("Error acreditando pago de fiado (venta):", pagoFiadoError)
        }
      }
    }

    const nuevoMontoAbonado = parseFloat(venta.monto_abonado || "0") + totalPagos
    const nuevoEstado = calcularEstadoPago(nuevoMontoAbonado, parseFloat(venta.total))

    await supabaseAdmin
      .from("ventas")
      .update({
        monto_abonado: nuevoMontoAbonado,
        estado_pago: nuevoEstado,
      })
      .eq("id", ventaId)

    const responseBody = {
      pagos: pagosCreados.map(p => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
        costoFinancieroPorcentaje: p.costo_financiero_porcentaje,
        costoFinancieroMonto: p.costo_financiero_monto,
      })),
      venta: {
        montoAbonado: nuevoMontoAbonado,
        estadoPago: nuevoEstado,
        pendiente: parseFloat(venta.total) - nuevoMontoAbonado,
      },
    }

    if (claimed && barrierAvailable) {
      await supabaseAdmin
        .from("pago_idempotency")
        .update({ response: responseBody })
        .eq("organization_id", organizationId)
        .eq("idempotency_key", key!)
    }

    // Mark success BEFORE the return so the finally block skips cleanup
    success = true
    return NextResponse.json(responseBody, { status: 201 })
  } finally {
    // Poison-row cleanup: if we claimed a row but the mutations didn't complete
    // successfully, delete it so retries can re-claim instead of 409 forever.
    if (!success && claimed && barrierAvailable && key) {
      await supabaseAdmin
        .from("pago_idempotency")
        .delete()
        .eq("organization_id", organizationId)
        .eq("idempotency_key", key)
    }
  }
}
