import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const pagoVentaSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  numeroReferencia: z.string().optional(),
  observaciones: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
})

function calcularEstadoPago(montoAbonado: number, total: number): string {
  if (montoAbonado <= 0) return "PENDIENTE"
  if (montoAbonado >= total) return "PAGADO"
  return "PAGADO_PARCIAL"
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdminOrVendedor()
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

    // Obtener venta y verificar org
    const { data: venta, error: fetchError } = await supabaseAdmin
      .from("ventas")
      .select("*")
      .eq("id", ventaId)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    if (venta.estado === "ANULADA") {
      return NextResponse.json(
        { error: "No se pueden registrar pagos en una venta anulada" },
        { status: 400 }
      )
    }

    // Validar que no se pague más del pendiente
    const pendiente = parseFloat(venta.total) - parseFloat(venta.monto_abonado || "0")
    if (data.monto > pendiente) {
      return NextResponse.json(
        { error: `El monto excede el pendiente (${pendiente.toFixed(2)})` },
        { status: 400 }
      )
    }

    // Crear pago
    const { data: pago, error: pagoError } = await supabaseAdmin
      .from("pagos_venta")
      .insert({
        venta_id: ventaId,
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

    // Actualizar venta
    const nuevoMontoAbonado = parseFloat(venta.monto_abonado || "0") + data.monto
    const nuevoEstado = calcularEstadoPago(nuevoMontoAbonado, parseFloat(venta.total))

    await supabaseAdmin
      .from("ventas")
      .update({
        monto_abonado: nuevoMontoAbonado,
        estado_pago: nuevoEstado,
      })
      .eq("id", ventaId)

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
        venta: {
          montoAbonado: nuevoMontoAbonado,
          estadoPago: nuevoEstado,
          pendiente: parseFloat(venta.total) - nuevoMontoAbonado,
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
    console.error("Error creating pago venta:", error)
    return NextResponse.json(
      { error: "Error al registrar pago" },
      { status: 500 }
    )
  }
}
