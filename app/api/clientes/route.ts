import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { enforcePlanLimit } from "@/lib/plan-limits"
import { z } from "zod"

const clienteSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().min(1, "El teléfono es requerido"),
  email: z.string().email().optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""

    let query = supabaseAdmin
      .from("clientes")
      .select("id, nombre, telefono, email, direccion, dni, created_at")
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,telefono.ilike.%${search}%,dni.ilike.%${search}%`
      )
    }

    const { data: clientes, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(clientes)
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

    return NextResponse.json(cliente, { status: 201 })
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
