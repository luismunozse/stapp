import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"
import bcrypt from "bcryptjs"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data: tecnicos, error: dbError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        nombre,
        email,
        telefono,
        activo,
        especialidades,
        avatar_url,
        fecha_ingreso_tecnico,
        porcentaje_comision,
        ordenes_servicio:ordenes_servicio!tecnico_id (
          id,
          estado
        )
      `)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .order("activo", { ascending: false })
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
        telefono: tecnico.telefono ?? null,
        activo: tecnico.activo !== false,
        especialidades: tecnico.especialidades ?? [],
        avatarUrl: tecnico.avatar_url ?? null,
        fechaIngresoTecnico: tecnico.fecha_ingreso_tecnico ?? null,
        porcentajeComision: Number(tecnico.porcentaje_comision ?? 0),
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
    const {
      nombre,
      email,
      password,
      porcentajeComision,
      costoHora,
      telefono,
      especialidades,
      fechaIngresoTecnico,
    } = body

    if (!nombre || !email || !password) {
      return NextResponse.json(
        { error: "Nombre, email y contraseña son requeridos" },
        { status: 400 }
      )
    }

    const porcentajeNum = Number(porcentajeComision ?? 0)
    if (!Number.isFinite(porcentajeNum) || porcentajeNum < 0 || porcentajeNum > 100) {
      return NextResponse.json(
        { error: "El porcentaje de comisión debe estar entre 0 y 100" },
        { status: 400 }
      )
    }

    const costoHoraNum = Number(costoHora ?? 0)
    if (!Number.isFinite(costoHoraNum) || costoHoraNum < 0) {
      return NextResponse.json(
        { error: "El costo por hora debe ser mayor o igual a 0" },
        { status: 400 }
      )
    }

    const especialidadesArr = Array.isArray(especialidades)
      ? especialidades.filter((e) => typeof e === "string" && e.length > 0)
      : []

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
        porcentaje_comision: porcentajeNum,
        costo_hora: costoHoraNum,
        telefono: telefono || null,
        especialidades: especialidadesArr,
        fecha_ingreso_tecnico: fechaIngresoTecnico || null,
        activo: true,
      })
      .select("id, nombre, email, porcentaje_comision, costo_hora, telefono, especialidades, fecha_ingreso_tecnico, activo")
      .single()

    if (dbError) {
      // Trigger atomico de limite (race condition)
      if (isPlanLimitError(dbError)) {
        return planLimitErrorResponse(dbError)
      }
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
