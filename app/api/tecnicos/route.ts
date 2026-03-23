import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { enforcePlanLimit } from "@/lib/plan-limits"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"
import bcrypt from "bcryptjs"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    // Obtener técnicos con sus órdenes activas
    const { data: tecnicos, error: dbError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        nombre,
        email,
        ordenes_servicio:ordenes_servicio!tecnico_id (
          id,
          estado
        )
      `)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .order("nombre", { ascending: true })

    if (dbError) {
      throw dbError
    }

    const tecnicosConStats = tecnicos?.map((tecnico) => {
      const ordenes = tecnico.ordenes_servicio || []
      const ordenesActivas = ordenes.filter(
        (o: any) => ESTADOS_ACTIVOS.includes(o.estado)
      ).length
      const ordenesCompletadas = ordenes.filter(
        (o: any) => ESTADOS_COMPLETADOS.includes(o.estado)
      ).length

      return {
        id: tecnico.id,
        nombre: tecnico.nombre,
        email: tecnico.email,
        ordenesActivas,
        ordenesCompletadas,
      }
    })

    return NextResponse.json(tecnicosConStats, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching tecnicos:", error)
    return NextResponse.json(
      { error: "Error al obtener técnicos" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Verificar límite de técnicos del plan
    const limitError = await enforcePlanLimit(organizationId!, "tecnicos")
    if (limitError) return limitError

    const body = await request.json()
    const { nombre, email, password } = body

    if (!nombre || !email || !password) {
      return NextResponse.json(
        { error: "Nombre, email y contraseña son requeridos" },
        { status: 400 }
      )
    }

    // Verificar si el email ya existe
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "Ya existe un usuario con este email" },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const { data: tecnico, error: dbError } = await supabaseAdmin
      .from("users")
      .insert({
        nombre,
        email,
        password: hashedPassword,
        rol: "TECNICO",
        organization_id: organizationId!,
        email_verified: true,
      })
      .select("id, nombre, email")
      .single()

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(tecnico, { status: 201 })
  } catch (error) {
    console.error("Error creating tecnico:", error)
    return NextResponse.json(
      { error: "Error al crear técnico" },
      { status: 500 }
    )
  }
}
