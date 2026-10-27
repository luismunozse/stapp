import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura, sucursalParaLectura, assertSucursalEnOrg } from "@/lib/sucursal"
import { ordenesActivasTotales, sucursalParaListaPersonal, sucursalParaReasignar, type DestinoDeReasignacion } from "@/lib/sucursal-personal"
import { soloAtendidasPorEnEmbed } from "@/lib/sucursal-ordenes"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"
import bcrypt from "bcryptjs"

export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    // `?sucursalId=` scopes the list to one branch (BM-4); without it the request's
    // own scope applies. `?alcance=escritura` is what the order form sends: the branch
    // the order will be created in. See sucursalParaListaPersonal for who may ask for what.
    const { searchParams } = new URL(request.url)
    let sucursalId = await sucursalParaListaPersonal({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
      organizationId: organizationId!,
      sucursalSolicitada: searchParams.get("sucursalId"),
      alcance: searchParams.get("alcance") === "escritura" ? "escritura" : "lectura",
    })

    // The open-order counts of each technician are the orders the viewer's scope handles (the branch
    // the switcher selects, an ADMIN's, or his own): the same ones a bulk move of them touches.
    const alcance = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    const sucursalDelAlcance = alcance.verTodas ? null : alcance.sucursalId

    // `?paraReasignarDe=<id>` is the destination picker of a bulk move (an ADMIN's): the technicians
    // that can take every open order of that technician in the scope the move applies, which
    // may not be the technician's own branch (an order handled by another one). It also answers how
    // many orders the move touches, and whether they span several branches (then nobody is offered
    // and the screen asks for a branch).
    const origenId = searchParams.get("paraReasignarDe")
    let reasignacion: DestinoDeReasignacion | null = null
    if (role === "ADMIN" && origenId) {
      reasignacion = await sucursalParaReasignar({
        organizationId: organizationId!,
        origenId,
        sucursalDelAlcance,
      })
      sucursalId = reasignacion.sucursalId
    }

    let query = soloAtendidasPorEnEmbed(
      supabaseAdmin
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
        sucursal_id,
        ordenes_servicio:ordenes_servicio!tecnico_id (
          id,
          estado
        )
      `)
        .eq("rol", "TECNICO")
        .eq("organization_id", organizationId!),
      sucursalDelAlcance,
      "ordenes_servicio",
    )
      .order("activo", { ascending: false })
      .order("nombre", { ascending: true })
    if (sucursalId) query = query.eq("sucursal_id", sucursalId)

    const { data: tecnicos, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    // What gates deactivating or deleting a technician (screens of an ADMIN) is global: every open order he
    // holds, in every branch. On Todas the scoped count already is that; with a branch selected it is read
    // apart. The picker of a bulk move does not need it, and anyone else only sees his own scope.
    const totales =
      role === "ADMIN" && sucursalDelAlcance !== null && !reasignacion
        ? await ordenesActivasTotales(organizationId!, (tecnicos ?? []).map((t) => t.id))
        : null

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
        sucursalId: tecnico.sucursal_id ?? null,
        ordenesActivas,
        ordenesActivasTotal: totales ? totales.get(tecnico.id) ?? 0 : ordenesActivas,
        ordenesCompletadas,
      }
    })

    const cuerpo = reasignacion
      ? { tecnicos: tecnicosConStats, ordenesAMover: reasignacion.ordenes, variasSucursales: reasignacion.variasSucursales }
      : tecnicosConStats
    return NextResponse.json(cuerpo, {
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
    const { error, organizationId, role, session } = await requireAdmin()
    if (error) return error

    // El nuevo técnico se asigna a la sucursal activa del admin (principal por defecto).
    let sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })

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

    // An explicit branch is a request, not a hint: if it is not an active branch of
    // the org it is rejected instead of silently falling back to the principal. The
    // principal stays the fallback only when the body names no branch at all.
    const bodySucursalId = (body?.sucursalId ?? null) as string | null
    if (bodySucursalId) {
      if (!(await assertSucursalEnOrg(bodySucursalId, organizationId!, { soloActiva: true }))) {
        return NextResponse.json(
          { error: "La sucursal elegida no existe o está inactiva." },
          { status: 400 }
        )
      }
      sucursalId = bodySucursalId
    }

    if (!sucursalId) {
      return NextResponse.json(
        { error: "La organización no tiene sucursal principal" },
        { status: 400 }
      )
    }

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
        sucursal_id: sucursalId,
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
