import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { enforcePlanLimit } from "@/lib/plan-limits"
import bcrypt from "bcryptjs"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data: vendedores, error: dbError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        nombre,
        email,
        created_at,
        ventas (
          id,
          estado
        )
      `)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .order("nombre", { ascending: true })

    if (dbError) {
      throw dbError
    }

    const vendedoresConStats = (vendedores || []).map((vendedor) => {
      const ventas = vendedor.ventas || []
      const ventasCompletadas = ventas.filter(
        (v: any) => v.estado === "COMPLETADA"
      ).length

      return {
        id: vendedor.id,
        nombre: vendedor.nombre,
        email: vendedor.email,
        created_at: vendedor.created_at,
        ventasCompletadas,
        ventasTotal: ventas.length,
      }
    })

    return NextResponse.json(vendedoresConStats, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching vendedores:", error)
    return NextResponse.json(
      { error: "Error al obtener vendedores" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Verificar límite de vendedores del plan
    const limitError = await enforcePlanLimit(organizationId!, "vendedores")
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

    const { data: vendedor, error: dbError } = await supabaseAdmin
      .from("users")
      .insert({
        nombre,
        email,
        password: hashedPassword,
        rol: "VENDEDOR",
        organization_id: organizationId!,
        email_verified: true,
      })
      .select("id, nombre, email")
      .single()

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(vendedor, { status: 201 })
  } catch (error) {
    console.error("Error creating vendedor:", error)
    return NextResponse.json(
      { error: "Error al crear vendedor" },
      { status: 500 }
    )
  }
}
