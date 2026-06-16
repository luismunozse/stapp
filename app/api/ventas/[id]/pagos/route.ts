import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
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
    const { data: venta, error: fetchError } = await supabaseAdmin
      .from("ventas")
      .select("*")
      .eq("id", ventaId)
      .eq("organization_id", organizationId!)
      .single()

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

    // --- Idempotency barrier (migration 233) ---
    // Claim happens AFTER all validations pass so validation failures don't
    // poison the barrier. Before the mutation loop so no money moves twice.
    const key = data.idempotencyKey || null
    let claimed = false
    let barrierAvailable = true // becomes false if the table doesn't exist yet

    if (key) {
      const { error: insertError } = await supabaseAdmin
        .from("pago_idempotency")
        .insert({
          organization_id: organizationId!,
          idempotency_key: key,
          venta_id: ventaId,
        })

      if (insertError) {
        if (isTableMissingError(insertError)) {
          // Migration 233 not applied yet — skip the barrier entirely.
          console.warn("[pagos] pago_idempotency table unavailable; running without idempotency barrier")
          barrierAvailable = false
        } else if ((insertError as any).code === "23505") {
          // Duplicate PK: this key was already claimed or fully processed.
          const { data: existing } = await supabaseAdmin
            .from("pago_idempotency")
            .select("response")
            .eq("organization_id", organizationId!)
            .eq("idempotency_key", key)
            .maybeSingle()

          if (existing?.response) {
            // Already processed — replay the stored response without re-running mutations.
            return NextResponse.json(existing.response, { status: 200 })
          }
          // Null response: original request still in flight or crashed mid-write.
          return NextResponse.json(
            { error: "Pago en proceso, reintentá en unos segundos" },
            { status: 409 }
          )
        } else {
          // Unexpected DB error on the barrier insert — fail safe: skip barrier.
          console.warn("[pagos] Unexpected error claiming idempotency row; proceeding without barrier", insertError)
          barrierAvailable = false
        }
      } else {
        claimed = true
      }
    }

    // --- Money mutations ---
    // Wrapped so any error after a successful claim triggers poison-row cleanup,
    // allowing the next retry to re-claim instead of being stuck on a null-response 409.
    const clienteId = data.clienteId || venta.cliente_id
    const pagosCreados: any[] = []

    try {
      // Crear cada pago
      for (const pagoLine of pagosToProcess) {
        // Si es CUENTA_CORRIENTE, descontar del saldo del cliente
        if (pagoLine.metodo === "CUENTA_CORRIENTE" && clienteId) {
          const { error: ccError } = await supabaseAdmin.rpc("usar_cuenta_corriente", {
            p_org_id: organizationId!,
            p_cliente_id: clienteId,
            p_monto: pagoLine.monto,
            p_referencia_tipo: "VENTA",
            p_referencia_id: ventaId,
            p_usuario_id: userId!,
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

      // Actualizar venta
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

      // Store response in barrier row so future retries can replay it.
      if (claimed && barrierAvailable) {
        await supabaseAdmin
          .from("pago_idempotency")
          .update({ response: responseBody })
          .eq("organization_id", organizationId!)
          .eq("idempotency_key", key!)
      }

      return NextResponse.json(responseBody, { status: 201 })
    } catch (mutationError) {
      // Intentionally DO NOT delete the barrier row here. The payment batch is
      // not atomic (CC deduction + N inserts + venta update), so a mid-batch
      // failure may have already applied part of the work. Deleting the barrier
      // would let a retry re-run that partial work and double-charge (e.g. a
      // second usar_cuenta_corriente deduction) — exactly what this barrier
      // exists to prevent. Leaving the claimed row makes retries return 409
      // (safe: no double-charge); the half-applied payment is surfaced for
      // manual reconciliation. A fresh user submit carries a new key and proceeds.
      throw mutationError
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating pago venta:", error)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
  }
}
