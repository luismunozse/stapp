import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const { error, organizationId, session, role } = await requireAdmin()
    if (error) return error

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    const { searchParams } = new URL(request.url)
    const estadoPago = searchParams.get("estadoPago")

    // Two separate `!inner` queries instead of one dual-left-join query:
    // PostgREST embedded-resource filters only narrow the nested object —
    // they don't turn a left-embed into an inner join on the parent row.
    // `facturas` has no own `sucursal_id` column, so branch scoping must
    // go through `ordenes_servicio!inner` / `ventas!inner`, and a row only
    // ever matches one of the two (XOR constraint, migration 292). Merging
    // two `!inner` queries in JS keeps the existing org/branch filter
    // semantics identical to before this change.
    let ordenesQuery = supabaseAdmin
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

    let ventasQuery = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ventas!inner (
          id,
          numero_venta,
          cliente_nombre,
          cliente_id,
          organization_id
        ),
        pagos_parciales (*)
      `)
      .eq("ventas.organization_id", organizationId!)

    if (sid) {
      ordenesQuery = ordenesQuery.eq("ordenes_servicio.sucursal_id", sid)
      ventasQuery = ventasQuery.eq("ventas.sucursal_id", sid)
    }

    if (estadoPago) {
      ordenesQuery = ordenesQuery.eq("estado_pago", estadoPago)
      ventasQuery = ventasQuery.eq("estado_pago", estadoPago)
    }

    const [{ data: facturasOrden, error: ordenError }, { data: facturasVenta, error: ventaError }] =
      await Promise.all([ordenesQuery, ventasQuery])

    if (ordenError) throw ordenError
    if (ventaError) throw ventaError

    const formatPagos = (pagos: any[] | null) =>
      (pagos || [])
        .map((p: any) => ({
          id: p.id,
          monto: p.monto,
          metodoPago: p.metodo_pago,
          referencia: p.numero_referencia,
          fecha: p.fecha,
          notas: p.observaciones,
          cuotas: p.cuotas,
          recargoPorcentaje: p.recargo_porcentaje,
          montoOriginal: p.monto_original,
        }))
        .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    const facturasFormatted = [
      ...(facturasOrden || []).map((f: any) => ({
        id: f.id,
        origen: "orden" as const,
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
        pagos: formatPagos(f.pagos_parciales),
      })),
      ...(facturasVenta || []).map((f: any) => ({
        id: f.id,
        origen: "venta" as const,
        ventaId: f.venta_id,
        numeroFactura: f.numero_factura,
        fecha: f.fecha,
        subtotal: f.subtotal,
        iva: f.iva,
        total: f.total,
        montoAbonado: f.monto_abonado,
        estadoPago: f.estado_pago,
        createdAt: f.created_at,
        venta: {
          id: f.ventas.id,
          numeroVenta: f.ventas.numero_venta,
          clienteNombre: f.ventas.cliente_nombre,
          clienteId: f.ventas.cliente_id,
        },
        pagos: formatPagos(f.pagos_parciales),
      })),
    ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

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
