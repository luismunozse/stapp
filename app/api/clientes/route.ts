import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatCliente } from "@/lib/db-utils"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { z } from "zod"

const clienteSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().min(1, "El teléfono es requerido"),
  email: z.string().email().optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional(),
  tipoCliente: z.enum(["INDIVIDUAL", "EMPRESA"]).optional().default("INDIVIDUAL"),
  razonSocial: z.string().optional(),
  cuit: z.string().optional(),
  aceptaWhatsapp: z.boolean().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const tipoCliente = searchParams.get("tipoCliente") || ""
    const conDeuda = searchParams.get("conDeuda") === "true"
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""
    const aceptaWhatsappParam = searchParams.get("aceptaWhatsapp")

    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    const sortByParam = searchParams.get("sortBy") || "createdAt"
    const sortMap: Record<string, string> = {
      createdAt: "created_at",
      nombre: "nombre",
      telefono: "telefono",
      email: "email",
      deudaPendiente: "deuda_pendiente",
      ordenes: "ordenes_count",
      ultimaVisita: "ultima_visita",
    }
    const sortBy = sortMap[sortByParam] || "created_at"
    const sortOrder = searchParams.get("sortOrder") === "asc"

    // Helper para aplicar los mismos filtros a cualquier builder sobre la vista
    const applyFilters = (q: any) => {
      let query = q.eq("organization_id", organizationId!)
      if (search) {
        query = query.or(
          `nombre.ilike.%${search}%,telefono.ilike.%${search}%,dni.ilike.%${search}%,email.ilike.%${search}%,sectores_texto.ilike.%${search}%`
        )
      }
      if (tipoCliente) query = query.eq("tipo_cliente", tipoCliente)
      if (conDeuda) query = query.gt("deuda_pendiente", 0)
      if (fechaDesde) query = query.gte("created_at", `${fechaDesde}T00:00:00`)
      if (fechaHasta) query = query.lte("created_at", `${fechaHasta}T23:59:59`)
      if (aceptaWhatsappParam === "true") query = query.eq("acepta_whatsapp", true)
      if (aceptaWhatsappParam === "false") query = query.eq("acepta_whatsapp", false)
      return query
    }

    // Listado paginado
    const listQuery = applyFilters(
      supabaseAdmin.from("v_clientes_resumen").select("*", { count: "exact" })
    )
      .order(sortBy, { ascending: sortOrder })
      .range(offset, offset + limit - 1)

    const { data: clientes, error: dbError, count } = await listQuery
    if (dbError) throw dbError

    // Total adeudado del set filtrado (sin paginar)
    let totalDeuda = 0
    try {
      const { data: deudaRows } = await applyFilters(
        supabaseAdmin.from("v_clientes_resumen").select("deuda_pendiente")
      )
      totalDeuda = (deudaRows || []).reduce(
        (acc: number, r: any) => acc + parseFloat(r.deuda_pendiente || "0"),
        0
      )
    } catch (e) {
      console.error("Error calculando totalDeuda:", e)
    }

    return NextResponse.json({
      data: (clientes || []).map((c: any) => ({
        ...formatCliente(c),
        deudaPendiente: parseFloat(c.deuda_pendiente || "0"),
        ordenesCount: c.ordenes_count ?? 0,
        ultimaVisita: c.ultima_visita ?? null,
      })),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
      totalDeuda,
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return NextResponse.json(
      { error: "Error al obtener clientes" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    // Verificar límite de clientes del plan
    const limitError = await enforcePlanLimit(organizationId!, "clientes")
    if (limitError) return limitError

    const body = await request.json()
    const data = clienteSchema.parse(body)

    const { data: cliente, error: dbError } = await supabaseAdmin
      .from("clientes")
      .insert({
        nombre: data.nombre,
        telefono: data.telefono,
        email: data.email || null,
        direccion: data.direccion || null,
        dni: data.dni || null,
        tipo_cliente: data.tipoCliente || "INDIVIDUAL",
        razon_social: data.razonSocial || null,
        cuit: data.cuit || null,
        organization_id: organizationId!,
        acepta_whatsapp: data.aceptaWhatsapp ?? true,
      })
      .select()
      .single()

    if (dbError) {
      // Verificar si es error de duplicado
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un cliente con ese teléfono" },
          { status: 400 }
        )
      }
      // Trigger atomico de limite (race condition)
      if (isPlanLimitError(dbError)) {
        return planLimitErrorResponse(dbError)
      }
      throw dbError
    }

    return NextResponse.json(formatCliente(cliente), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating cliente:", error)
    return NextResponse.json(
      { error: "Error al crear cliente" },
      { status: 500 }
    )
  }
}
