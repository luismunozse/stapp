import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { todayInTimeZone, addMonthsToDateOnly, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { z } from "zod"

const pagoLineSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodo: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]),
  referencia: z.string().nullable().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargo: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  // Costo financiero (comisión de terminal que absorbe el comercio).
  // Se acepta el porcentaje y se computa el monto en el servidor, igual que en ventas/[id]/pagos.
  costoFinanciero: z.number().min(0).max(100).nullable().optional(),
  // Backward compat: callers antiguos que envían el monto/porcentaje ya calculados.
  costoFinancieroMonto: z.number().min(0).nullable().optional(),
  costoFinancieroPorcentaje: z.number().min(0).max(100).nullable().optional(),
})

const cobrosSchema = z.object({
  pagos: z.array(pagoLineSchema).min(1, "Debe incluir al menos un pago"),
  observaciones: z.string().optional(),
  descuento: z.number().min(0).optional(),
  // Request-level idempotency key: one stable UUID per submit attempt.
  // Offline retries reuse the same key so the barrier dedupes instead of
  // running the payment mutations twice.
  idempotencyKey: z.string().max(100).nullable().optional(),
})

// Returns true when the RPC error indicates migration 242 has not been applied yet.
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
// exist yet (migration 233 not applied). In that case the barrier is skipped.
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

// GET - Obtener cobros de una orden
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    const { data: cobros, error: dbError } = await supabaseAdmin
      .from("cobros_orden")
      .select("*")
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(
      (cobros || []).map((c: any) => ({
        id: c.id,
        monto: parseFloat(c.monto),
        metodoPago: c.metodo_pago,
        referencia: c.numero_referencia,
        observaciones: c.observaciones,
        cuotas: c.cuotas,
        recargoPorcentaje: c.recargo_porcentaje ? parseFloat(c.recargo_porcentaje) : null,
        montoOriginal: c.monto_original ? parseFloat(c.monto_original) : null,
        costoFinancieroMonto: c.costo_financiero_monto ? parseFloat(c.costo_financiero_monto) : null,
        costoFinancieroPorcentaje: c.costo_financiero_porcentaje ? parseFloat(c.costo_financiero_porcentaje) : null,
        fecha: c.created_at,
        anulado: c.anulado || false,
        anuladoAt: c.anulado_at,
        anuladoMotivo: c.anulado_motivo,
      }))
    )
  } catch (err) {
    console.error("Error fetching cobros:", err)
    return NextResponse.json({ error: "Error al obtener cobros" }, { status: 500 })
  }
}

// POST - Registrar cobro(s) en una orden
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden registrar cobros" }, { status: 403 })
    }

    const { id: ordenId } = await params
    const body = await request.json()
    const data = cobrosSchema.parse(body)

    // Obtener orden
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, costo_final, total_cobrado, estado_cobro, descuento_cobro, cliente_id, organization_id, estado, sucursal_id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // --- Atomic RPC path (migration 242) ---
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "registrar_cobros_orden_atomica",
      {
        p_org_id: organizationId!,
        p_orden_id: ordenId,
        p_usuario_id: userId!,
        p_pagos: data.pagos,
        p_observaciones: data.observaciones ?? null,
        p_descuento: data.descuento ?? 0,
        p_idempotency_key: data.idempotencyKey ?? null,
      }
    )

    if (!rpcError) {
      const result = rpcResult as { replayed: boolean; response: any }

      // Replayed: return stored response without re-generating cuotas
      if (result.replayed) {
        revalidateTag("dashboard", "max")
        return NextResponse.json(result.response, { status: 201 })
      }

      // Generate cuotas calendar (non-money, kept in the route)
      const cobrosResult: Array<{ id: string; monto: number; metodo: string; cuotas: number | null }> =
        result.response?.cobros ?? []

      // Base de los vencimientos = HOY en la tz de la org. Con new Date() (UTC en
      // Vercel), a las 21h ART la fecha base ya era mañana y las cuotas salían
      // corridas un día.
      const { data: orgTzRow } = await supabaseAdmin
        .from("organizations")
        .select("zona_horaria")
        .eq("id", organizationId!)
        .single()
      const baseHoy = todayInTimeZone(orgTzRow?.zona_horaria || DEFAULT_TIMEZONE)

      for (const cobro of cobrosResult) {
        if (cobro.cuotas && cobro.cuotas > 1) {
          const montoCuota = cobro.monto / cobro.cuotas
          const cuotasInsert = []
          for (let i = 1; i <= cobro.cuotas; i++) {
            cuotasInsert.push({
              cobro_id: cobro.id,
              orden_id: ordenId,
              organization_id: organizationId!,
              numero_cuota: i,
              total_cuotas: cobro.cuotas,
              monto: Math.round(montoCuota * 100) / 100,
              fecha_vencimiento: addMonthsToDateOnly(baseHoy, i),
              pagada: i === 1,
              fecha_pago: i === 1 ? new Date().toISOString() : null,
            })
          }
          await supabaseAdmin.from("cuotas_cobro").insert(cuotasInsert)
        }
      }

      revalidateTag("dashboard", "max")
      return NextResponse.json(
        {
          totalCobrado: result.response?.orden?.totalCobrado ?? 0,
          estadoCobro: result.response?.orden?.estadoCobro,
          descuento: result.response?.orden?.descuento ?? 0,
        },
        { status: 201 }
      )
    }

    // RPC function not deployed yet → fall back to hardened JS implementation
    if (isFunctionMissingError(rpcError)) {
      console.warn("[cobros] registrar_cobros_orden_atomica not found; falling back to JS path")
      return await runJsFallback({
        organizationId: organizationId!,
        userId: userId!,
        ordenId,
        orden,
        data,
      })
    }

    // Known business-rule errors from the RPC's RAISE EXCEPTION
    const msg = (rpcError as any).message ?? ""
    if (msg.includes("no encontrada")) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }
    if (msg.includes("excede el pendiente") || msg.toLowerCase().includes("saldo insuficiente")) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    console.error("[cobros] Unexpected RPC error:", rpcError)
    return NextResponse.json({ error: "Error al registrar cobro" }, { status: 500 })

  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating cobro:", err)
    return NextResponse.json({ error: "Error al registrar cobro" }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// JS fallback — hardened version of the original handler.
// Bug A fix: cobros_orden insert error is now checked and propagates as 500.
// ---------------------------------------------------------------------------
async function runJsFallback(opts: {
  organizationId: string
  userId: string
  ordenId: string
  orden: any
  data: z.infer<typeof cobrosSchema>
}): Promise<NextResponse> {
  const { organizationId, userId, ordenId, orden, data } = opts

  const costoFinal = parseFloat(orden.costo_final || "0")
  const descuentoAnterior = parseFloat(orden.descuento_cobro || "0")
  const descuentoNuevo = data.descuento || 0
  const descuentoTotal = descuentoAnterior + descuentoNuevo
  const totalCobrado = parseFloat(orden.total_cobrado || "0")
  const pendiente = costoFinal - descuentoTotal - totalCobrado
  const totalPagos = data.pagos.reduce((sum, p) => sum + p.monto, 0)

  if (totalPagos > pendiente + 0.01) {
    return NextResponse.json(
      { error: `El monto total (${totalPagos.toFixed(2)}) excede el pendiente (${pendiente.toFixed(2)})` },
      { status: 400 }
    )
  }

  // Registrar descuento si aplica
  if (descuentoNuevo > 0) {
    await supabaseAdmin
      .from("ordenes_servicio")
      .update({ descuento_cobro: descuentoTotal })
      .eq("id", ordenId)
  }

  // Crear cada cobro — Bug A fix: destructure error and fail fast on insert error
  for (const pago of data.pagos) {
    // Si es CUENTA_CORRIENTE, descontar del saldo
    if (pago.metodo === "CUENTA_CORRIENTE" && orden.cliente_id) {
      const { error: ccError } = await supabaseAdmin.rpc("usar_cuenta_corriente", {
        p_org_id: organizationId,
        p_cliente_id: orden.cliente_id,
        p_monto: pago.monto,
        p_referencia_tipo: "ORDEN",
        p_referencia_id: ordenId,
        p_usuario_id: userId,
        // Derived from the orden's own sucursal_id (parent record), not the
        // current operator's active cookie.
        p_sucursal_id: orden.sucursal_id ?? null,
      })
      if (ccError) {
        return NextResponse.json({ error: ccError.message || "Error al usar cuenta corriente" }, { status: 400 })
      }
    }

    const cfPorcentaje = pago.costoFinanciero ?? pago.costoFinancieroPorcentaje ?? null
    const cfMonto = pago.costoFinanciero != null && pago.costoFinanciero > 0
      ? Math.round(pago.monto * (pago.costoFinanciero / 100) * 100) / 100
      : (pago.costoFinancieroMonto ?? null)

    // HARDENED: check insert error (was silently ignored before — bug A)
    const { error: insertError } = await supabaseAdmin.from("cobros_orden").insert({
      orden_id: ordenId,
      organization_id: organizationId,
      monto: pago.monto,
      metodo_pago: pago.metodo,
      numero_referencia: pago.referencia || null,
      observaciones: data.observaciones || null,
      cuotas: pago.cuotas || null,
      recargo_porcentaje: pago.recargo || null,
      monto_original: pago.montoOriginal || null,
      costo_financiero_monto: cfMonto,
      costo_financiero_porcentaje: cfPorcentaje,
      usuario_id: userId,
    })

    if (insertError) {
      console.error("[cobros fallback] cobros_orden insert failed:", insertError)
      return NextResponse.json({ error: "Error al registrar cobro" }, { status: 500 })
    }
  }

  // Reconciliar fiado
  const entregada = orden.estado === "ENTREGADO" || orden.estado === "ENTREGADO_SIN_REPARACION"
  if (entregada && orden.cliente_id) {
    const totalExterno = data.pagos
      .filter((p) => p.metodo !== "CUENTA_CORRIENTE")
      .reduce((sum, p) => sum + p.monto, 0)
    if (totalExterno > 0) {
      const { error: pagoFiadoError } = await supabaseAdmin.rpc("pagar_fiado_cuenta_corriente", {
        p_org_id: organizationId,
        p_cliente_id: orden.cliente_id,
        p_monto: totalExterno,
        p_referencia_tipo: "ORDEN",
        p_referencia_id: ordenId,
        p_usuario_id: userId,
        p_sucursal_id: orden.sucursal_id ?? null,
      })
      if (pagoFiadoError) {
        console.error("Error acreditando pago de fiado:", pagoFiadoError)
      }
    }
  }

  // Recalcular estado
  await supabaseAdmin.rpc("recalcular_estado_cobro", { p_orden_id: ordenId })

  // Generar calendario de cuotas si algún pago tiene cuotas > 1
  for (const pago of data.pagos) {
    if (pago.cuotas && pago.cuotas > 1) {
      const { data: ultimoCobro } = await supabaseAdmin
        .from("cobros_orden")
        .select("id")
        .eq("orden_id", ordenId)
        .eq("monto", pago.monto)
        .eq("metodo_pago", pago.metodo)
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (ultimoCobro) {
        const montoCuota = pago.monto / pago.cuotas
        const cuotasInsert = []
        for (let i = 1; i <= pago.cuotas; i++) {
          const fechaVencimiento = new Date()
          fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i)
          cuotasInsert.push({
            cobro_id: ultimoCobro.id,
            orden_id: ordenId,
            organization_id: organizationId,
            numero_cuota: i,
            total_cuotas: pago.cuotas,
            monto: Math.round(montoCuota * 100) / 100,
            fecha_vencimiento: fechaVencimiento.toISOString().split("T")[0],
            pagada: i === 1,
            fecha_pago: i === 1 ? new Date().toISOString() : null,
          })
        }
        await supabaseAdmin.from("cuotas_cobro").insert(cuotasInsert)
      }
    }
  }

  // Obtener estado actualizado
  const { data: ordenActualizada } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("total_cobrado, estado_cobro, descuento_cobro")
    .eq("id", ordenId)
    .single()

  revalidateTag("dashboard", "max")

  return NextResponse.json({
    totalCobrado: parseFloat(ordenActualizada?.total_cobrado || "0"),
    estadoCobro: ordenActualizada?.estado_cobro,
    descuento: parseFloat(ordenActualizada?.descuento_cobro || "0"),
  }, { status: 201 })
}

// DELETE - Anular un cobro (soft-delete con auditoría)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden anular cobros" }, { status: 403 })
    }

    const { id: ordenId } = await params
    const { searchParams } = new URL(request.url)
    const cobroId = searchParams.get("cobroId")
    const motivo = searchParams.get("motivo") || "Anulado por administrador"

    if (!cobroId) {
      return NextResponse.json({ error: "Se requiere cobroId" }, { status: 400 })
    }

    // Verificar que la orden no esté entregada
    const { data: ordenCheck } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("estado, cliente_id, sucursal_id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenCheck?.estado === "ENTREGADO" || ordenCheck?.estado === "ENTREGADO_SIN_REPARACION") {
      return NextResponse.json(
        { error: "No se pueden anular cobros de órdenes ya entregadas" },
        { status: 400 }
      )
    }

    // Verificar que el cobro existe y pertenece a la orden (friendly pre-checks)
    const { data: cobro, error: cobroError } = await supabaseAdmin
      .from("cobros_orden")
      .select("id, monto, anulado, metodo_pago")
      .eq("id", cobroId)
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (cobroError || !cobro) {
      return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 })
    }

    if (cobro.anulado) {
      return NextResponse.json({ error: "El cobro ya fue anulado" }, { status: 400 })
    }

    // --- Atomic RPC path (migration 242) ---
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "anular_cobro_orden_atomica",
      {
        p_org_id: organizationId!,
        p_orden_id: ordenId,
        p_cobro_id: cobroId,
        p_usuario_id: userId!,
        p_motivo: motivo,
      }
    )

    if (!rpcError) {
      revalidateTag("dashboard", "max")
      return NextResponse.json({ message: "Cobro anulado correctamente" })
    }

    // RPC function not deployed yet → hardened JS fallback (bug B fix)
    if (isFunctionMissingError(rpcError)) {
      console.warn("[cobros] anular_cobro_orden_atomica not found; falling back to JS path")
      return await runAnularJsFallback({
        organizationId: organizationId!,
        userId: userId!,
        ordenId,
        cobroId,
        cobro,
        ordenCheck,
        motivo,
      })
    }

    // Map RPC business-rule errors
    const msg = (rpcError as any).message ?? ""
    if (msg.includes("no encontrado")) {
      return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 })
    }
    if (msg.includes("ya fue anulado")) {
      return NextResponse.json({ error: "El cobro ya fue anulado" }, { status: 400 })
    }

    console.error("[cobros] Unexpected RPC error on anular:", rpcError)
    return NextResponse.json({ error: "Error al anular cobro" }, { status: 500 })

  } catch (err) {
    console.error("Error anulando cobro:", err)
    return NextResponse.json({ error: "Error al anular cobro" }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// JS fallback for DELETE — hardened version of the original handler.
// Bug B fix: devolver_cuenta_corriente is called FIRST; on error we return 500
// WITHOUT marking anulado=true, so the customer is not left de-credited without
// the cobro being properly reversed.
// ---------------------------------------------------------------------------
async function runAnularJsFallback(opts: {
  organizationId: string
  userId: string
  ordenId: string
  cobroId: string
  cobro: any
  ordenCheck: any
  motivo: string
}): Promise<NextResponse> {
  const { organizationId, userId, ordenId, cobroId, cobro, ordenCheck, motivo } = opts

  // HARDENED (bug B fix): reverse CC credit FIRST — if this fails, return 500
  // WITHOUT committing anulado=true. The original code marked anulado first,
  // then swallowed the devolver error.
  if (cobro.metodo_pago === "CUENTA_CORRIENTE" && ordenCheck?.cliente_id) {
    const { error: devError } = await supabaseAdmin.rpc("devolver_cuenta_corriente", {
      p_org_id: organizationId,
      p_cliente_id: ordenCheck.cliente_id,
      p_monto: parseFloat(cobro.monto as any),
      p_referencia_tipo: "ORDEN",
      p_referencia_id: ordenId,
      p_usuario_id: userId,
      p_observaciones: "Anulacion de cobro con cuenta corriente",
      // Derived from the orden's own sucursal_id (parent record), not the
      // current operator's active cookie.
      p_sucursal_id: ordenCheck.sucursal_id ?? null,
    })
    if (devError) {
      console.error("[cobros fallback] devolver_cuenta_corriente failed, aborting anulado:", devError)
      return NextResponse.json({ error: "Error al reacreditar cuenta corriente" }, { status: 500 })
    }
  }

  // Only mark anulado after CC reversal succeeds (or cobro is not CC)
  await supabaseAdmin
    .from("cobros_orden")
    .update({
      anulado: true,
      anulado_at: new Date().toISOString(),
      anulado_por: userId,
      anulado_motivo: motivo,
    })
    .eq("id", cobroId)
    .eq("organization_id", organizationId)

  // Recalcular estado de cobro
  await supabaseAdmin.rpc("recalcular_estado_cobro", { p_orden_id: ordenId })

  revalidateTag("dashboard", "max")

  return NextResponse.json({ message: "Cobro anulado correctamente" })
}
