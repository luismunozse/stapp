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

    let ordenesQuery = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, codigo_orden, dispositivo, clientes (nombre), facturas (id)")
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])

    let ventasQuery = supabaseAdmin
      .from("ventas")
      .select("id, numero_venta, cliente_nombre, total, facturas (id)")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")

    if (sid) {
      ordenesQuery = ordenesQuery.eq("sucursal_id", sid)
      ventasQuery = ventasQuery.eq("sucursal_id", sid)
    }

    const { data: ordenes, error: ordenesError } = await ordenesQuery
      .order("fecha_ingreso", { ascending: false })
      .limit(200)

    if (ordenesError) throw ordenesError

    const { data: ventas, error: ventasError } = await ventasQuery
      .order("created_at", { ascending: false })
      .limit(200)

    if (ventasError) throw ventasError

    return NextResponse.json(
      {
        ordenes: (ordenes || [])
          .filter((o: any) => !o.facturas || o.facturas.length === 0)
          .map((o: any) => ({
            id: o.id,
            numeroOrden: o.numero_orden,
            codigoOrden: o.codigo_orden,
            dispositivo: o.dispositivo,
            clienteNombre: o.clientes?.nombre || "Sin cliente",
          })),
        ventas: (ventas || [])
          .filter((v: any) => !v.facturas || v.facturas.length === 0)
          .map((v: any) => ({
            id: v.id,
            numeroVenta: v.numero_venta,
            clienteNombre: v.cliente_nombre,
            total: parseFloat(v.total),
          })),
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    )
  } catch (error) {
    console.error("Error fetching facturacion candidatos:", error)
    return NextResponse.json({ error: "Error al obtener candidatos" }, { status: 500 })
  }
}
