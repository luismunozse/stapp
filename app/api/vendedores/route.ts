import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura, assertSucursalEnOrg } from "@/lib/sucursal"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import bcrypt from "bcryptjs"
import { z } from "zod"

const vendedorCreateSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es requerido"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  telefono: z.string().trim().optional().nullable(),
  porcentajeComision: z.coerce
    .number()
    .min(0, "La comisión debe ser mayor o igual a 0")
    .max(100, "La comisión no puede superar 100")
    .optional()
    .default(0),
  sucursalId: z.string().optional().nullable(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get("search") || "").trim()
    const activoParam = searchParams.get("activo")
    const page = Math.max(parseInt(searchParams.get("page") || "1"), 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20"), 1), 100)
    const offset = (page - 1) * limit

    let query = supabaseAdmin
      .from("users")
      .select(
        "id, nombre, email, telefono, activo, porcentaje_comision, created_at",
        { count: "exact" }
      )
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .order("activo", { ascending: false })
      .order("nombre", { ascending: true })

    if (search) {
      const escaped = search.replace(/[%,]/g, "")
      query = query.or(`nombre.ilike.%${escaped}%,email.ilike.%${escaped}%,telefono.ilike.%${escaped}%`)
    }

    if (activoParam === "true") query = query.eq("activo", true)
    else if (activoParam === "false") query = query.eq("activo", false)

    query = query.range(offset, offset + limit - 1)

    const { data: vendedores, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    // Stats agregadas vía RPC (lifetime, sin filtro de fecha)
    const { data: statsRows } = await supabaseAdmin.rpc("get_vendedores_stats", {
      p_org_id: organizationId!,
    })

    const statsByVendedor = new Map<string, { ventasTotal: number; ventasCompletadas: number }>()
    for (const row of statsRows || []) {
      statsByVendedor.set(row.vendedor_id, {
        ventasTotal: Number(row.ventas_total || 0),
        ventasCompletadas: Number(row.ventas_completadas || 0),
      })
    }

    const vendedoresConStats = (vendedores || []).map((vendedor: any) => {
      const stats = statsByVendedor.get(vendedor.id) ?? {
        ventasTotal: 0,
        ventasCompletadas: 0,
      }
      return {
        id: vendedor.id,
        nombre: vendedor.nombre,
        email: vendedor.email,
        telefono: vendedor.telefono ?? null,
        activo: vendedor.activo !== false,
        porcentajeComision: Number(vendedor.porcentaje_comision ?? 0),
        created_at: vendedor.created_at,
        ventasCompletadas: stats.ventasCompletadas,
        ventasTotal: stats.ventasTotal,
      }
    })

    return NextResponse.json(
      {
        data: vendedoresConStats,
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    )
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
    const { error, organizationId, role, session } = await requireAdmin()
    if (error) return error

    // Verificar límite de vendedores del plan
    const limitError = await enforcePlanLimit(organizationId!, "vendedores")
    if (limitError) return limitError

    const body = await request.json()
    const data = vendedorCreateSchema.parse(body)

    // El nuevo vendedor se asigna a la sucursal activa del admin (principal por defecto).
    let sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    // Si el form mandó una sucursal explícita y es válida para la org, usarla.
    if (data.sucursalId && (await assertSucursalEnOrg(data.sucursalId, organizationId!))) {
      sucursalId = data.sucursalId
    }

    if (!sucursalId) {
      return NextResponse.json(
        { error: "La organización no tiene sucursal principal" },
        { status: 400 }
      )
    }

    // Verificar si el email ya existe
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", data.email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "Ya existe un usuario con este email" },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(data.password, 10)

    const { data: vendedor, error: dbError } = await supabaseAdmin
      .from("users")
      .insert({
        nombre: data.nombre,
        email: data.email,
        password: hashedPassword,
        rol: "VENDEDOR",
        organization_id: organizationId!,
        sucursal_id: sucursalId,
        email_verified: true,
        telefono: data.telefono?.trim() || null,
        porcentaje_comision: data.porcentajeComision,
        activo: true,
      })
      .select("id, nombre, email, telefono, activo, porcentaje_comision")
      .single()

    if (dbError) {
      // Trigger atomico de limite (race condition)
      if (isPlanLimitError(dbError)) {
        return planLimitErrorResponse(dbError)
      }
      throw dbError
    }

    return NextResponse.json(vendedor, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating vendedor:", error)
    return NextResponse.json(
      { error: "Error al crear vendedor" },
      { status: 500 }
    )
  }
}
