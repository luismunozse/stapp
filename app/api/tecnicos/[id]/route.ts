import { NextResponse } from "next/server"
import { requireAdmin, requireAdminOrSelf } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { EMBED_ORDENES_ACTIVAS_TOTALES, soloActivasEnTodasLasSucursales, totalDeOrdenesActivas } from "@/lib/sucursal-personal"
import { soloAtendidasPorEnEmbed } from "@/lib/sucursal-ordenes"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"
import bcrypt from "bcryptjs"

/**
 * The row of the detail. Typed by hand: the select is one of two strings (the second adds the total), and the
 * compiler cannot read the columns of a union of them.
 */
interface FilaDelDetalle {
  id: string
  nombre: string
  email: string
  telefono: string | null
  activo: boolean | null
  especialidades: string[] | null
  avatar_url: string | null
  fecha_ingreso_tecnico: string | null
  porcentaje_comision: number | null
  costo_hora: number | null
  created_at: string
  horario_laboral: unknown
  activas_del_alcance?: unknown[] | null
  completadas_del_alcance?: unknown[] | null
  activas_totales?: unknown[] | null
}

// What the detail of a technician reads of him. The orders are counted through embeds of his own row: the open
// ones and the finished ones of the viewer's scope (narrowed to it by the route), by state, each under its alias.
const COLUMNAS_DEL_DETALLE = `
        id,
        nombre,
        email,
        telefono,
        activo,
        especialidades,
        avatar_url,
        fecha_ingreso_tecnico,
        porcentaje_comision,
        costo_hora,
        created_at,
        horario_laboral,
        activas_del_alcance:ordenes_servicio!tecnico_id (id),
        completadas_del_alcance:ordenes_servicio!tecnico_id (id)`

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { error, organizationId, role, session } = await requireAdminOrSelf(id)
    if (error) return error

    // The open-order count is what the viewer's scope handles, which is also what a bulk reassignment
    // of them moves: an ADMIN reads the branch the switcher selects (every one on Todas). The technician
    // himself reads everything assigned to him, from any branch (BM-6).
    let sucursalDelAlcance: string | null = null
    if (role === "ADMIN") {
      const alcance = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
      sucursalDelAlcance = alcance.verTodas ? null : alcance.sucursalId
    }

    // What gates deactivating or deleting him is global: every open order he holds, in every branch, on Todas as
    // well. Only an ADMIN's answer carries it, so only an ADMIN's read asks for it; the technician himself gets
    // the count of what is assigned to him. The scoped count stays for what a reassignment from this screen moves.
    const conTotal = role === "ADMIN"

    // The counts are embeds of the technician's own orders, filtered by state on their alias: PostgREST cuts every
    // to-many embed at db-max-rows (1000 on Supabase) for each parent, so an embed of ALL his orders would lose the
    // open ones that come after the first thousand. The finished count is a figure of the page, not a gate.
    let consulta = soloAtendidasPorEnEmbed(
      soloAtendidasPorEnEmbed(
        supabaseAdmin
          .from("users")
          .select(conTotal ? `${COLUMNAS_DEL_DETALLE}, ${EMBED_ORDENES_ACTIVAS_TOTALES}` : COLUMNAS_DEL_DETALLE)
          .eq("id", id)
          .eq("rol", "TECNICO")
          .eq("organization_id", organizationId!)
          .in("activas_del_alcance.estado", ESTADOS_ACTIVOS as unknown as string[])
          .in("completadas_del_alcance.estado", ESTADOS_COMPLETADOS as unknown as string[]),
        sucursalDelAlcance,
        "activas_del_alcance",
      ),
      sucursalDelAlcance,
      "completadas_del_alcance",
    )
    if (conTotal) consulta = soloActivasEnTodasLasSucursales(consulta, organizationId!)
    const { data, error: dbError } = await consulta.single()
    const tecnico = data as unknown as FilaDelDetalle | null

    if (dbError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const ordenesActivas = (tecnico.activas_del_alcance || []).length
    const ordenesCompletadas = (tecnico.completadas_del_alcance || []).length
    const ordenesActivasTotal = conTotal ? totalDeOrdenesActivas(tecnico) : ordenesActivas

    return NextResponse.json({
      id: tecnico.id,
      nombre: tecnico.nombre,
      email: tecnico.email,
      telefono: tecnico.telefono ?? null,
      activo: tecnico.activo !== false,
      especialidades: tecnico.especialidades ?? [],
      avatarUrl: tecnico.avatar_url ?? null,
      fechaIngresoTecnico: tecnico.fecha_ingreso_tecnico ?? null,
      porcentajeComision: Number(tecnico.porcentaje_comision ?? 0),
      costoHora: Number(tecnico.costo_hora ?? 0),
      createdAt: tecnico.created_at,
      horarioLaboral: tecnico.horario_laboral ?? null,
      ordenesActivas,
      ordenesActivasTotal,
      ordenesCompletadas,
    })
  } catch (error) {
    console.error("Error fetching tecnico:", error)
    return NextResponse.json(
      { error: "Error al obtener técnico" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
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
      horarioLaboral,
    } = body

    if (porcentajeComision !== undefined) {
      const p = Number(porcentajeComision)
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return NextResponse.json(
          { error: "El porcentaje de comisión debe estar entre 0 y 100" },
          { status: 400 }
        )
      }
    }

    if (costoHora !== undefined) {
      const c = Number(costoHora)
      if (!Number.isFinite(c) || c < 0) {
        return NextResponse.json(
          { error: "El costo por hora debe ser mayor o igual a 0" },
          { status: 400 }
        )
      }
    }

    if (especialidades !== undefined && !Array.isArray(especialidades)) {
      return NextResponse.json(
        { error: "especialidades debe ser un array" },
        { status: 400 }
      )
    }

    // Verificar que el técnico existe
    const { data: tecnico, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    // Verificar email único si cambió
    if (email && email !== tecnico.email) {
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
    }

    const updateData: Record<string, any> = {}
    if (nombre) updateData.nombre = nombre
    if (email) updateData.email = email
    if (password) updateData.password = await bcrypt.hash(password, 10)
    if (porcentajeComision !== undefined) updateData.porcentaje_comision = Number(porcentajeComision)
    if (costoHora !== undefined) updateData.costo_hora = Number(costoHora)
    if (telefono !== undefined) updateData.telefono = telefono || null
    if (especialidades !== undefined) {
      updateData.especialidades = especialidades.filter(
        (e: unknown) => typeof e === "string" && e.length > 0
      )
    }
    if (fechaIngresoTecnico !== undefined) updateData.fecha_ingreso_tecnico = fechaIngresoTecnico || null
    if (horarioLaboral !== undefined) {
      // Validación liviana: objeto con claves de día -> array de {de, a}
      if (horarioLaboral !== null && typeof horarioLaboral !== "object") {
        return NextResponse.json({ error: "horarioLaboral inválido" }, { status: 400 })
      }
      updateData.horario_laboral = horarioLaboral || null
    }

    const { data: updatedTecnico, error: updateError } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id, nombre, email, porcentaje_comision, costo_hora, telefono, especialidades, fecha_ingreso_tecnico, activo, horario_laboral")
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(updatedTecnico)
  } catch (error) {
    console.error("Error updating tecnico:", error)
    return NextResponse.json(
      { error: "Error al actualizar técnico" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Verificar que el técnico existe y obtener órdenes activas: every open order he holds, in every branch. The embed
    // asks for open orders only: PostgREST cuts a to-many embed at db-max-rows (1000 on Supabase) for each parent, and
    // an embed of ALL his orders would lose the open ones behind a thousand old ones.
    const { data: tecnico, error: fetchError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        ordenes_servicio:ordenes_servicio!tecnico_id (id)
      `)
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .in("ordenes_servicio.estado", ESTADOS_ACTIVOS as unknown as string[])
      .single()

    if (fetchError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const ordenesActivas = tecnico.ordenes_servicio || []

    if (ordenesActivas.length > 0) {
      return NextResponse.json(
        { error: "No se puede eliminar un técnico con órdenes activas asignadas" },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: "Técnico eliminado correctamente" })
  } catch (error) {
    console.error("Error deleting tecnico:", error)
    return NextResponse.json(
      { error: "Error al eliminar técnico" },
      { status: 500 }
    )
  }
}
