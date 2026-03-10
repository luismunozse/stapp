import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatCliente } from "@/lib/db-utils"
import { enforcePlanLimit } from "@/lib/plan-limits"
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
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""

    // Paginación
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    // Sorting
    const sortByParam = searchParams.get("sortBy") || "createdAt"
    const sortMap: Record<string, string> = {
      createdAt: "created_at",
      nombre: "nombre",
      telefono: "telefono",
      email: "email",
    }
    const sortBy = sortMap[sortByParam] || "created_at"
    const sortOrder = searchParams.get("sortOrder") === "asc"

    let query = supabaseAdmin
      .from("clientes")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId!)
      .order(sortBy, { ascending: sortOrder })

    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,telefono.ilike.%${search}%,dni.ilike.%${search}%,email.ilike.%${search}%`
      )
    }

    // Aplicar paginación
    query = query.range(offset, offset + limit - 1)

    const { data: clientes, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json({
      data: (clientes || []).map(formatCliente),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
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
