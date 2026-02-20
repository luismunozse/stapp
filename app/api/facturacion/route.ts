import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estadoPago = searchParams.get("estadoPago")

    let query = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          codigo_orden,
          dispositivo,
          organization_id,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .order("fecha", { ascending: false })

    if (estadoPago) {
      query = query.eq("estado_pago", estadoPago)
    }

    const { data: facturas, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    // Formatear respuesta
    const facturasFormatted = facturas?.map(f => ({
      id: f.id,
      ordenId: f.orden_id,
      numeroFactura: f.numero_factura,
      fecha: f.fecha,
      subtotal: f.subtotal,
      iva: f.iva,
      total: f.total,
      montoAbonado: f.monto_abonado,
      estadoPago: f.estado_pago,
      createdAt: f.created_at,
      orden: {
        id: f.ordenes_servicio.id,
        numeroOrden: f.ordenes_servicio.numero_orden,
        codigoOrden: f.ordenes_servicio.codigo_orden,
        dispositivo: f.ordenes_servicio.dispositivo,
        cliente: f.ordenes_servicio.clientes,
      },
      pagos: f.pagos_parciales?.map((p: any) => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        notas: p.observaciones,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
      })).sort((a: any, b: any) =>
        new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      ),
    }))

    return NextResponse.json(facturasFormatted, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching facturas:", error)
    return NextResponse.json(
      { error: "Error al obtener facturas" },
      { status: 500 }
    )
  }
}
