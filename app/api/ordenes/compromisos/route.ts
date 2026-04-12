import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const now = new Date()
    const inicioHoy = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const finHoy = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
    const finManana = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59)

    const estadosFinales = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "CANCELADO", "SIN_REPARACION"]

    // Query all non-final orders that have fecha_prometida
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

    const { data: ordenes, error: dbError } = await query

    if (dbError) throw dbError

    const vencidas: any[] = []
    const hoy: any[] = []
    const manana: any[] = []

    for (const orden of ordenes || []) {
      const fechaP = new Date(orden.fecha_prometida)
      const item = {
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

      if (fechaP < inicioHoy) {
        vencidas.push(item)
      } else if (fechaP >= inicioHoy && fechaP <= finHoy) {
        hoy.push(item)
      } else if (fechaP > finHoy && fechaP <= finManana) {
        manana.push(item)
      }
    }

    return NextResponse.json({
      vencidas,
      hoy,
      manana,
      totalUrgentes: vencidas.length + hoy.length,
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
