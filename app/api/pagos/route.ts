import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
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
const pagoSchema = z.object({
  facturaId: z.string().min(1, "Remito requerido"),
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

// Returns true when the RPC error indicates migration 243 has not been applied yet
// (the function registrar_pago_factura_atomica does not exist in the DB).
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

// Returns true when the error indicates the pago_idempotency table does not
// exist yet (migration 233 not applied).
function isTableMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden registrar pagos" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = pagoSchema.parse(body)

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

    // Obtener factura actual y verificar org
    const { data: factura, error: fetchError } = await supabaseAdmin
      .from("facturas")
      .select(`*, ordenes_servicio!inner(organization_id, cliente_id, sucursal_id)`)
      .eq("id", data.facturaId)
      .single()

    if (fetchError || !factura) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }

    const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // --- Atomic RPC path (migration 243) ---
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
      "registrar_pago_factura_atomica",
      {
        p_org_id: organizationId!,
        p_factura_id: data.facturaId,
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
      console.warn("[pagos] registrar_pago_factura_atomica not found; falling back to JS path")
      return await runJsFallback({
        organizationId: organizationId!,
        userId: userId!,
        factura,
        data,
        pagosToProcess,
      })
    }

    // Known business-rule errors from the RPC's RAISE EXCEPTION
    const msg = rpcError.message ?? ""
    if (msg.includes("no encontrada")) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }
    if (msg.includes("No autorizado")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    if (
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
    console.error("Error creating pago:", error)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// JS fallback — identical logic to the original handler, preserved for
// deploy-safety while migration 243 is not yet applied.
// Hardened: checks pagos_parciales insert error (throws) + facturas update error (throws).
// ---------------------------------------------------------------------------
async function runJsFallback(opts: {
  organizationId: string
  userId: string
  factura: any
  data: z.infer<typeof pagoSchema>
  pagosToProcess: z.infer<typeof pagoLineSchema>[]
}): Promise<NextResponse> {
  const { organizationId, userId, factura, data, pagosToProcess } = opts

  // Guard: cannot pay an already-voided invoice
  if (factura.estado_pago === 'ANULADA') {
    return NextResponse.json(
      { error: "No se pueden registrar pagos en un remito anulado" },
      { status: 400 }
    )
  }

  // Guard: overpayment check (mirrors the RPC guard for the fallback path)
  const totalPagos = pagosToProcess.reduce((sum, p) => sum + p.monto, 0)
  const pendiente = factura.total - (factura.monto_abonado || 0)
  if (totalPagos > pendiente + 0.01) {
    return NextResponse.json(
      { error: `El monto total (${totalPagos.toFixed(2)}) excede el pendiente (${pendiente.toFixed(2)})` },
      { status: 400 }
    )
  }

  const clienteId = data.clienteId || (factura.ordenes_servicio as any)?.cliente_id
  const pagosCreados: any[] = []

  for (const pagoLine of pagosToProcess) {
    // Si es CUENTA_CORRIENTE, descontar del saldo del cliente
    if (pagoLine.metodo === "CUENTA_CORRIENTE" && clienteId) {
      const { error: ccError } = await supabaseAdmin.rpc("usar_cuenta_corriente", {
        p_org_id: organizationId,
        p_cliente_id: clienteId,
        p_monto: pagoLine.monto,
        p_referencia_tipo: "FACTURA",
        p_referencia_id: data.facturaId,
        p_usuario_id: userId,
        // Derived from the parent orden's sucursal_id, not the current
        // operator's active cookie.
        p_sucursal_id: (factura.ordenes_servicio as any)?.sucursal_id ?? null,
      })
      if (ccError) {
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
      .from("pagos_parciales")
      .insert({
        factura_id: data.facturaId,
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

  // Actualizar factura — check the update error (hardened vs original which did not check it)
  const nuevoMontoAbonado = factura.monto_abonado + totalPagos
  const nuevoEstado = calcularEstadoPago(nuevoMontoAbonado, factura.total)

  const { error: updateError } = await supabaseAdmin
    .from("facturas")
    .update({
      monto_abonado: nuevoMontoAbonado,
      estado_pago: nuevoEstado,
    })
    .eq("id", data.facturaId)

  if (updateError) throw updateError

  return NextResponse.json(
    {
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
      factura: {
        montoAbonado: nuevoMontoAbonado,
        estadoPago: nuevoEstado,
        pendiente: factura.total - nuevoMontoAbonado,
      },
    },
    { status: 201 }
  )
}
