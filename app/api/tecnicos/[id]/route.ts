import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: tecnico, error: dbError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        nombre,
        email,
        created_at,
        ordenes_servicio:ordenes_servicio!tecnico_id (
          id,
          numero_orden,
          dispositivo,
          estado,
          fecha_ingreso,
          clientes (nombre)
        )
      `)
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const ordenes = tecnico.ordenes_servicio || []
    const ordenesActivas = ordenes.filter(
      (o: any) => ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"].includes(o.estado)
    )
    const ordenesCompletadas = ordenes.filter(
      (o: any) => ["REPARADO", "ENTREGADO"].includes(o.estado)
    )

    return NextResponse.json({
      id: tecnico.id,
      nombre: tecnico.nombre,
      email: tecnico.email,
      createdAt: tecnico.created_at,
      ordenesActivas: ordenesActivas.length,
      ordenesCompletadas: ordenesCompletadas.length,
      ordenes: ordenes
        .sort((a: any, b: any) =>
          new Date(b.fecha_ingreso).getTime() - new Date(a.fecha_ingreso).getTime()
        )
        .map((o: any) => ({
          id: o.id,
          numeroOrden: o.numero_orden,
          dispositivo: o.dispositivo,
          estado: o.estado,
          fechaIngreso: o.fecha_ingreso,
          cliente: o.clientes?.nombre,
        })),
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
    const { nombre, email, password } = body

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

    const { data: updatedTecnico, error: updateError } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select("id, nombre, email")
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
      (o: any) => ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"].includes(o.estado)
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
