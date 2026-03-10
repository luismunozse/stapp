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
          precio_unitario,
          nombre,
          inventario_id
        ),
        facturas (id),
        cotizaciones (
          id,
          estado,
          total,
          items_cotizacion (
            id,
            descripcion,
            cantidad,
            precio_unitario,
            subtotal
          )
        )
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

    // Buscar cotización aprobada si existe
    const cotizacionAprobada = (orden.cotizaciones || []).find(
      (c: any) => c.estado === "ACEPTADA"
    )

    // Calcular subtotal: prioridad cotización aprobada > costo_final > repuestos > presupuesto
    let subtotal = 0
    let itemsParaFactura: Array<{
      cotizacionItemId?: string
      descripcion: string
      cantidad: number
      precioUnitario: number
      subtotal: number
      tipo: string
    }> = []

    if (cotizacionAprobada && cotizacionAprobada.items_cotizacion?.length > 0) {
      // Usar items de la cotización aprobada
      itemsParaFactura = cotizacionAprobada.items_cotizacion.map((item: any) => ({
        cotizacionItemId: item.id,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precio_unitario,
        subtotal: item.subtotal,
        tipo: "SERVICIO",
      }))
      subtotal = cotizacionAprobada.total
    } else if (orden.costo_final) {
      subtotal = orden.costo_final
      // Desglosar repuestos + mano de obra
      const repuestosTotal = (orden.repuestos_orden || []).reduce(
        (sum: number, r: any) => sum + r.cantidad * r.precio_unitario, 0
      )
      if (orden.repuestos_orden?.length > 0) {
        for (const r of orden.repuestos_orden) {
          itemsParaFactura.push({
            descripcion: r.nombre || "Repuesto",
            cantidad: r.cantidad,
            precioUnitario: r.precio_unitario,
            subtotal: r.cantidad * r.precio_unitario,
            tipo: "REPUESTO",
          })
        }
      }
      const manoDeObra = subtotal - repuestosTotal
      if (manoDeObra > 0) {
        itemsParaFactura.push({
          descripcion: "Mano de obra",
          cantidad: 1,
          precioUnitario: manoDeObra,
          subtotal: manoDeObra,
          tipo: "MANO_DE_OBRA",
        })
      }
    } else if (orden.repuestos_orden && orden.repuestos_orden.length > 0) {
      for (const r of orden.repuestos_orden) {
        itemsParaFactura.push({
          descripcion: r.nombre || "Repuesto",
          cantidad: r.cantidad,
          precioUnitario: r.precio_unitario,
          subtotal: r.cantidad * r.precio_unitario,
          tipo: "REPUESTO",
        })
      }
      subtotal = itemsParaFactura.reduce((sum, i) => sum + i.subtotal, 0)
    } else if (orden.presupuesto) {
      subtotal = orden.presupuesto
      itemsParaFactura.push({
        descripcion: "Servicio de reparación",
        cantidad: 1,
        precioUnitario: orden.presupuesto,
        subtotal: orden.presupuesto,
        tipo: "SERVICIO",
      })
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

    // Crear factura con vinculación a cotización
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
        cotizacion_id: cotizacionAprobada?.id || null,
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Crear items de factura si hay desglose
    if (itemsParaFactura.length > 0) {
      const { error: itemsError } = await supabaseAdmin
        .from("items_factura")
        .insert(
          itemsParaFactura.map((item) => ({
            factura_id: factura.id,
            cotizacion_item_id: item.cotizacionItemId || null,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precioUnitario,
            subtotal: item.subtotal,
            tipo: item.tipo,
          }))
        )

      if (itemsError) {
        console.error("Error creating items_factura:", itemsError)
      }
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

    // Obtener items creados
    const { data: itemsFactura } = await supabaseAdmin
      .from("items_factura")
      .select("*")
      .eq("factura_id", factura.id)

    return NextResponse.json({
      id: factura.id,
      ordenId: factura.orden_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      estadoPago: factura.estado_pago,
      cotizacionId: cotizacionAprobada?.id || null,
      items: (itemsFactura || []).map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
        tipo: i.tipo,
      })),
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
