import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const { activo } = body

    if (typeof activo !== "boolean") {
      return NextResponse.json(
        { error: "activo debe ser boolean" },
        { status: 400 }
      )
    }

    const { data: tecnico, error: fetchError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        activo,
        ordenes_servicio:ordenes_servicio!tecnico_id (id, estado)
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
    ).length

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ activo })
      .eq("id", id)

    if (updateError) throw updateError

    return NextResponse.json({
      id,
      activo,
      ordenesActivas,
      warning:
        !activo && ordenesActivas > 0
          ? `El técnico tiene ${ordenesActivas} orden(es) activa(s). Considerá reasignarlas.`
          : null,
    })
  } catch (err) {
    console.error("Error updating tecnico estado:", err)
    return NextResponse.json(
      { error: "Error al actualizar estado del técnico" },
      { status: 500 }
    )
  }
}
