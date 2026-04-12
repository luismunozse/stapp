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
  facturaId: z.string().min(1, "Factura requerida"),
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
})

function calcularEstadoPago(montoAbonado: number, total: number): string {
  if (montoAbonado <= 0) return "PENDIENTE"
  if (montoAbonado >= total) return "PAGADO"
  return "PAGADO_PARCIAL"
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
      .select(`*, ordenes_servicio!inner(organization_id, cliente_id)`)
      .eq("id", data.facturaId)
      .single()

    if (fetchError || !factura) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }

    const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Validar que no se pague más del total pendiente
    const pendiente = factura.total - factura.monto_abonado
    const totalPagos = pagosToProcess.reduce((sum, p) => sum + p.monto, 0)
    if (totalPagos > pendiente + 0.01) {
      return NextResponse.json(
        { error: `El monto total (${totalPagos.toFixed(2)}) excede el pendiente (${pendiente.toFixed(2)})` },
        { status: 400 }
      )
    }

    const clienteId = data.clienteId || (factura.ordenes_servicio as any)?.cliente_id
    const pagosCreados = []

    // Crear cada pago
    for (const pagoLine of pagosToProcess) {
      // Si es CUENTA_CORRIENTE, descontar del saldo del cliente
      if (pagoLine.metodo === "CUENTA_CORRIENTE" && clienteId) {
        const { error: ccError } = await supabaseAdmin.rpc("usar_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: clienteId,
          p_monto: pagoLine.monto,
          p_referencia_tipo: "FACTURA",
          p_referencia_id: data.facturaId,
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

    // Actualizar factura
    const nuevoMontoAbonado = factura.monto_abonado + totalPagos
    const nuevoEstado = calcularEstadoPago(nuevoMontoAbonado, factura.total)

    await supabaseAdmin
      .from("facturas")
      .update({
        monto_abonado: nuevoMontoAbonado,
        estado_pago: nuevoEstado,
      })
      .eq("id", data.facturaId)

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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating pago:", error)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
  }
}
