import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextInvoiceNumber } from "@/lib/counters"
import { z } from "zod"

const generarFacturaSchema = z.object({
  ordenId: z.string().min(1, "La orden es requerida"),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden generar facturas" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { ordenId } = generarFacturaSchema.parse(body)

    // Verificar que la orden existe, está completada y pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id,
        estado,
        costo_final,
        presupuesto,
        sena,
        organization_id,
        numero_orden,
        dispositivo,
        clientes (*),
        repuestos_orden (
          cantidad,
          precio_unitario
        ),
        facturas (id)
      `)
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    if (orden.estado !== "REPARADO" && orden.estado !== "ENTREGADO") {
      return NextResponse.json(
        { error: "La orden debe estar reparada para generar factura" },
        { status: 400 }
      )
    }

    // Verificar si ya existe una factura
    if (orden.facturas && orden.facturas.length > 0) {
      return NextResponse.json(
        { error: "Ya existe una factura para esta orden" },
        { status: 400 }
      )
    }

    // Calcular subtotal (costo final o suma de repuestos)
    let subtotal = orden.costo_final || 0
    if (!subtotal && orden.repuestos_orden && orden.repuestos_orden.length > 0) {
      subtotal = orden.repuestos_orden.reduce(
        (sum: number, r: any) => sum + r.cantidad * r.precio_unitario,
        0
      )
    }
    if (!subtotal && orden.presupuesto) {
      subtotal = orden.presupuesto
    }

    // Sin IVA - precio final directo
    const iva = 0
    const total = subtotal

    // Considerar seña como monto ya abonado
    const sena = typeof orden.sena === "number" ? orden.sena : 0
    const montoAbonado = sena
    const estadoPago = montoAbonado >= total ? "PAGADO" : montoAbonado > 0 ? "PAGADO_PARCIAL" : "PENDIENTE"

    // Obtener número de factura atómico
    const numeroFactura = await getNextInvoiceNumber(organizationId!)

    // Crear factura
    const { data: factura, error: createError } = await supabaseAdmin
      .from("facturas")
      .insert({
        orden_id: ordenId,
        numero_factura: numeroFactura,
        subtotal,
        iva,
        total,
        monto_abonado: montoAbonado,
        estado_pago: estadoPago,
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Si hay seña, registrarla como pago parcial en el historial
    if (sena > 0) {
      await supabaseAdmin
        .from("pagos_parciales")
        .insert({
          factura_id: factura.id,
          monto: sena,
          metodo_pago: "EFECTIVO",
          observaciones: "Seña abonada al momento del ingreso",
        })
    }

    return NextResponse.json({
      id: factura.id,
      ordenId: factura.orden_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      estadoPago: factura.estado_pago,
      orden: {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        cliente: orden.clientes,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error generating factura:", error)
    return NextResponse.json(
      { error: "Error al generar factura" },
      { status: 500 }
    )
  }
}
