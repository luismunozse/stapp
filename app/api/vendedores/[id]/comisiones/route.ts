import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

type EstadoFiltro = "pendiente" | "pagada" | "all"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // El id del vendedor viaja en la URL: con requireAuth cualquier rol leia
    // lo que gana CUALQUIER vendedor —ventas, porcentaje, montos, si ya se le
    // pago— cambiando un id. La pantalla que la consume es la liquidacion,
    // que ya era admin-only en el middleware.
    //
    // Esto NO es 'mis comisiones'. Si mañana el vendedor tiene que ver las
    // propias, va por una ruta que se scopee sola, como ya hace
    // GET /api/comisiones con el tecnico.
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const estadoParam = (searchParams.get("estado") || "all") as EstadoFiltro
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    let query = supabaseAdmin
      .from("v_comisiones_ventas")
      .select(
        "venta_id, numero_venta, cliente_nombre, created_at, total, porcentaje_comision, monto_comision, comision_pagada, fecha_pago_comision, comision_pago_notas"
      )
      .eq("organization_id", organizationId!)
      .eq("vendedor_id", id)
      .order("created_at", { ascending: false })

    if (estadoParam === "pendiente") query = query.eq("comision_pagada", false)
    else if (estadoParam === "pagada") query = query.eq("comision_pagada", true)

    if (desde) query = query.gte("created_at", desde)
    if (hasta) query = query.lte("created_at", hasta)

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    const comisiones = (data || []).map((c: any) => ({
      ventaId: c.venta_id,
      numeroVenta: c.numero_venta,
      clienteNombre: c.cliente_nombre,
      fecha: c.created_at,
      total: Number(c.total || 0),
      porcentajeComision: Number(c.porcentaje_comision || 0),
      montoComision: Number(c.monto_comision || 0),
      pagada: c.comision_pagada,
      fechaPago: c.fecha_pago_comision,
      notas: c.comision_pago_notas,
    }))

    const totales = comisiones.reduce(
      (acc, c) => {
        acc.devengada += c.montoComision
        if (c.pagada) acc.pagada += c.montoComision
        else acc.pendiente += c.montoComision
        return acc
      },
      { devengada: 0, pagada: 0, pendiente: 0 }
    )

    return NextResponse.json({ comisiones, totales })
  } catch (error) {
    console.error("Error fetching comisiones:", error)
    return NextResponse.json(
      { error: "Error al obtener comisiones" },
      { status: 500 }
    )
  }
}
