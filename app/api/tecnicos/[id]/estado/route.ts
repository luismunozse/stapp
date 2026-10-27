import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { ordenesActivasTotales } from "@/lib/sucursal-personal"
import { soloAtendidasPorEnEmbed } from "@/lib/sucursal-ordenes"
import { avisoDeOrdenesActivas } from "@/lib/tecnico-ordenes-activas"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role, session } = await requireAdmin()
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

    // Deactivating a technician is a GLOBAL write, so the count that warns about it is every open order he
    // holds, in every branch. The part in the scope the ADMIN works in (what a reassignment moves) is read
    // apart, to tell him how many of them belong to other branches.
    const alcance = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    const sucursalDelAlcance = alcance.verTodas ? null : alcance.sucursalId

    const { data: tecnico, error: fetchError } = await soloAtendidasPorEnEmbed(
      supabaseAdmin
        .from("users")
        .select(`
        id,
        activo,
        ordenes_servicio:ordenes_servicio!tecnico_id (id, estado)
      `)
        .eq("id", id)
        .eq("rol", "TECNICO")
        .eq("organization_id", organizationId!),
      sucursalDelAlcance,
      "ordenes_servicio",
    ).single()

    if (fetchError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const enAlcance = (tecnico.ordenes_servicio || []).filter(
      (o: any) => ESTADOS_ACTIVOS.includes(o.estado)
    ).length
    // On Todas the count above already is the total.
    const ordenesActivas = sucursalDelAlcance === null ? enAlcance : (await ordenesActivasTotales(organizationId!, [id])).get(id) ?? 0

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ activo })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (updateError) throw updateError

    return NextResponse.json({
      id,
      activo,
      ordenesActivas,
      warning: activo ? null : avisoDeOrdenesActivas(ordenesActivas, enAlcance, "El técnico tiene"),
    })
  } catch (err) {
    console.error("Error updating tecnico estado:", err)
    return NextResponse.json(
      { error: "Error al actualizar estado del técnico" },
      { status: 500 }
    )
  }
}
