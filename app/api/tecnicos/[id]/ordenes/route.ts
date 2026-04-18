import { NextResponse } from "next/server"
import { requireAdminOrSelf } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"

type EstadoFiltro = "activas" | "completadas" | "todas" | string

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { error, organizationId } = await requireAdminOrSelf(id)
    if (error) return error
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("limit") || "10", 10))
    )
    const estado = (searchParams.get("estado") || "todas") as EstadoFiltro
    const q = (searchParams.get("q") || "").trim()

    const { data: tecnico } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .single()
    if (!tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select(
        `
        id,
        numero_orden,
        codigo_orden,
        dispositivo,
        estado,
        fecha_ingreso,
        fecha_completado,
        fecha_prometida,
        costo_final,
        clientes ( nombre )
      `,
        { count: "exact" }
      )
      .eq("organization_id", organizationId!)
      .eq("tecnico_id", id)

    if (estado === "activas") {
      query = query.in("estado", ESTADOS_ACTIVOS as unknown as string[])
    } else if (estado === "completadas") {
      query = query.in("estado", ESTADOS_COMPLETADOS as unknown as string[])
    } else if (estado !== "todas") {
      query = query.eq("estado", estado)
    }

    if (q) {
      const safe = q.replace(/[%,]/g, " ")
      query = query.or(`dispositivo.ilike.%${safe}%,codigo_orden.ilike.%${safe}%`)
    }

    const from = (page - 1) * limit
    const to = from + limit - 1

    const { data, count, error: dbError } = await query
      .order("fecha_ingreso", { ascending: false })
      .range(from, to)

    if (dbError) throw dbError

    const items = (data || []).map((o: any) => ({
      id: o.id,
      numeroOrden: o.numero_orden,
      codigoOrden: o.codigo_orden,
      dispositivo: o.dispositivo,
      estado: o.estado,
      fechaIngreso: o.fecha_ingreso,
      fechaCompletado: o.fecha_completado,
      fechaPrometida: o.fecha_prometida,
      costoFinal: o.costo_final == null ? null : Number(o.costo_final),
      cliente: o.clientes?.nombre ?? null,
    }))

    return NextResponse.json(
      {
        items,
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error listing tecnico ordenes:", err)
    return NextResponse.json(
      { error: "Error al obtener órdenes" },
      { status: 500 }
    )
  }
}
