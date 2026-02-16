import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const pagoSchema = z.object({
  facturaId: z.string().min(1, "Factura requerida"),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  numeroReferencia: z.string().optional(),
  observaciones: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
})

// Función para calcular el estado de pago
function calcularEstadoPago(montoAbonado: number, total: number): string {
  if (montoAbonado <= 0) return "PENDIENTE"
  if (montoAbonado >= total) return "PAGADO"
  return "PAGADO_PARCIAL"
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden registrar pagos" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = pagoSchema.parse(body)

    // Obtener factura actual y verificar org
    const { data: factura, error: fetchError } = await supabaseAdmin
      .from("facturas")
      .select(`*, ordenes_servicio!inner(organization_id)`)
      .eq("id", data.facturaId)
      .single()

    if (fetchError || !factura) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Validar que no se pague más del total pendiente
    const pendiente = factura.total - factura.monto_abonado
    if (data.monto > pendiente) {
      return NextResponse.json(
        { error: `El monto excede el pendiente (${pendiente.toFixed(2)})` },
        { status: 400 }
      )
    }

    // Calcular nuevo monto abonado y estado
    const nuevoMontoAbonado = factura.monto_abonado + data.monto
    const nuevoEstado = calcularEstadoPago(nuevoMontoAbonado, factura.total)

    // Crear pago
    const { data: pago, error: pagoError } = await supabaseAdmin
      .from("pagos_parciales")
      .insert({
        factura_id: data.facturaId,
        monto: data.monto,
        metodo_pago: data.metodoPago,
        numero_referencia: data.numeroReferencia || null,
        observaciones: data.observaciones || null,
        cuotas: data.cuotas || null,
        recargo_porcentaje: data.recargoPorcentaje || null,
        monto_original: data.montoOriginal || null,
      })
      .select()
      .single()

    if (pagoError) throw pagoError

    // Actualizar factura
    await supabaseAdmin
      .from("facturas")
      .update({
        monto_abonado: nuevoMontoAbonado,
        estado_pago: nuevoEstado,
      })
      .eq("id", data.facturaId)

    return NextResponse.json(
      {
        pago: {
          id: pago.id,
          monto: pago.monto,
          metodoPago: pago.metodo_pago,
          referencia: pago.numero_referencia,
          fecha: pago.fecha,
          cuotas: pago.cuotas,
          recargoPorcentaje: pago.recargo_porcentaje,
          montoOriginal: pago.monto_original,
        },
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
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating pago:", error)
    return NextResponse.json(
      { error: "Error al registrar pago" },
      { status: 500 }
    )
  }
}
