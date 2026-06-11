import { NextResponse } from "next/server"
import { requireAdmin, requireAdminOrSelf } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"
import bcrypt from "bcryptjs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { error, organizationId } = await requireAdminOrSelf(id)
    if (error) return error

    const { data: tecnico, error: dbError } = await supabaseAdmin
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
        costo_hora,
        created_at,
        horario_laboral,
        ordenes_servicio:ordenes_servicio!tecnico_id ( estado )
      `)
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const ordenes = tecnico.ordenes_servicio || []
    const ordenesActivas = ordenes.filter((o: any) =>
      ESTADOS_ACTIVOS.includes(o.estado)
    ).length
    const ordenesCompletadas = ordenes.filter((o: any) =>
      ESTADOS_COMPLETADOS.includes(o.estado)
    ).length

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

    // Verificar que el técnico existe y obtener órdenes activas
    const { data: tecnico, error: fetchError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        ordenes_servicio:ordenes_servicio!tecnico_id (
          id,
          estado
        )
      `)
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const ordenesActivas = (tecnico.ordenes_servicio || []).filter(
      (o: any) => ESTADOS_ACTIVOS.includes(o.estado)
    )

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
