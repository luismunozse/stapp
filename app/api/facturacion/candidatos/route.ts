import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: ordenes, error: ordenesError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, codigo_orden, dispositivo, clientes (nombre), facturas (id)")
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .order("fecha_ingreso", { ascending: false })
      .limit(200)

    if (ordenesError) throw ordenesError

    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from("ventas")
      .select("id, numero_venta, cliente_nombre, total, facturas (id)")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
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
