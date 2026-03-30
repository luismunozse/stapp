import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Obtener token de kiosco
    const { data: kiosk } = await supabaseAdmin
      .from("kiosk_tokens")
      .select(`
        id, name, config, organization_id,
        organizations (
          nombre, nombre_mostrar, logo_url,
          brand_color_primary, brand_color_secondary
        )
      `)
      .eq("token", token)
      .eq("activo", true)
      .single()

    if (!kiosk) {
      return NextResponse.json({ error: "Kiosco no encontrado" }, { status: 404 })
    }

    const config = kiosk.config as Record<string, unknown>
    const filterEstados = (config?.filter_estados as string[]) || []

    // Obtener órdenes activas (no entregadas, no canceladas)
    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, numero_orden, codigo_orden, dispositivo,
        tipo_dispositivo, marca, estado, fecha_ingreso,
        clientes (nombre)
      `)
      .eq("organization_id", kiosk.organization_id)
      .not("estado", "in", '("ENTREGADO","ENTREGADO_SIN_REPARACION","CANCELADO","SIN_REPARACION")')
      .order("fecha_ingreso", { ascending: false })
      .limit(50)

    if (filterEstados.length > 0) {
      query = query.in("estado", filterEstados)
    }

    const { data: ordenes } = await query

    const org = kiosk.organizations as unknown as Record<string, unknown>

    return NextResponse.json({
      kiosk: {
        name: kiosk.name,
        config: kiosk.config,
      },
      organizacion: {
        nombre: org?.nombre_mostrar || org?.nombre || "",
        logoUrl: org?.logo_url || null,
        colorPrimary: org?.brand_color_primary || "#3b82f6",
        colorSecondary: org?.brand_color_secondary || "#1d4ed8",
      },
      ordenes: (ordenes || []).map((o: Record<string, unknown>) => ({
        id: o.id,
        numeroOrden: o.numero_orden,
        codigoOrden: o.codigo_orden,
        dispositivo: o.dispositivo,
        tipoDispositivo: o.tipo_dispositivo,
        marca: o.marca,
        estado: o.estado,
        fechaIngreso: o.fecha_ingreso,
        clienteNombre: (o.clientes as Record<string, unknown>)?.nombre || "—",
      })),
    })
  } catch (error) {
    console.error("Error fetching kiosk data:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
