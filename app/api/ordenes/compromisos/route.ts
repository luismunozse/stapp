import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get("desde") || ""
    const hasta = searchParams.get("hasta") || ""

    const estadosFinales = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "CANCELADO", "SIN_REPARACION"]

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id,
        numero_orden,
        codigo_orden,
        dispositivo,
        tipo_dispositivo,
        marca,
        estado,
        fecha_prometida,
        fecha_ingreso,
        presupuesto,
        clientes (id, nombre, telefono),
        users:tecnico_id (id, nombre)
      `)
      .eq("organization_id", organizationId!)
      .not("fecha_prometida", "is", null)
      .not("estado", "in", `(${estadosFinales.join(",")})`)
      .order("fecha_prometida", { ascending: true })

    if (role === "TECNICO") {
      query = query.eq("tecnico_id", userId!)
    }

    // Filter by date range if provided (for calendar month view)
    if (desde) {
      query = query.gte("fecha_prometida", `${desde}T00:00:00`)
    }
    if (hasta) {
      query = query.lte("fecha_prometida", `${hasta}T23:59:59`)
    }

    const { data: ordenes, error: dbError } = await query

    if (dbError) throw dbError

    const now = new Date()
    const inicioHoy = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    let totalVencidas = 0
    let totalHoy = 0

    const items = (ordenes || []).map((orden) => {
      const fechaP = new Date(orden.fecha_prometida)
      const finHoy = new Date(inicioHoy)
      finHoy.setHours(23, 59, 59)

      let urgencia: "vencida" | "hoy" | "futuro" = "futuro"
      if (fechaP < inicioHoy) {
        urgencia = "vencida"
        totalVencidas++
      } else if (fechaP <= finHoy) {
        urgencia = "hoy"
        totalHoy++
      }

      return {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        codigoOrden: orden.codigo_orden,
        dispositivo: orden.dispositivo,
        tipoDispositivo: orden.tipo_dispositivo,
        marca: orden.marca,
        estado: orden.estado,
        fechaPrometida: orden.fecha_prometida,
        fechaIngreso: orden.fecha_ingreso,
        presupuesto: orden.presupuesto,
        urgencia,
        cliente: orden.clientes ? {
          id: (orden.clientes as any).id,
          nombre: (orden.clientes as any).nombre,
          telefono: (orden.clientes as any).telefono,
        } : null,
        tecnico: orden.users ? {
          id: (orden.users as any).id,
          nombre: (orden.users as any).nombre,
        } : null,
      }
    })

    return NextResponse.json({
      ordenes: items,
      totalVencidas,
      totalHoy,
      totalUrgentes: totalVencidas + totalHoy,
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching compromisos:", error)
    return NextResponse.json(
      { error: "Error al obtener compromisos" },
      { status: 500 }
    )
  }
}
