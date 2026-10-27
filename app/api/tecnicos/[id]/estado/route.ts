import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { EMBED_ORDENES_ACTIVAS_TOTALES, soloActivasEnTodasLasSucursales, totalDeOrdenesActivas } from "@/lib/sucursal-personal"
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
    // holds, in every branch. The part in the scope the ADMIN works in (what a reassignment moves) comes in
    // the same read, to tell him how many of them belong to other branches. Both are embeds of the technician's
    // own row: there is no second read, so a reactivation has nothing extra to fail on.
    const alcance = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    const sucursalDelAlcance = alcance.verTodas ? null : alcance.sucursalId

    const { data: tecnico, error: fetchError } = await soloActivasEnTodasLasSucursales(
      soloAtendidasPorEnEmbed(
        supabaseAdmin
          .from("users")
          .select(`
        id,
        activo,
        ordenes_del_alcance:ordenes_servicio!tecnico_id (id, estado),
        ${EMBED_ORDENES_ACTIVAS_TOTALES}
      `)
          .eq("id", id)
          .eq("rol", "TECNICO")
          .eq("organization_id", organizationId!),
        sucursalDelAlcance,
        "ordenes_del_alcance",
      ),
      organizationId!,
    ).single()

    if (fetchError || !tecnico) {
      return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })
    }

    const enAlcance = (tecnico.ordenes_del_alcance || []).filter(
      (o: any) => ESTADOS_ACTIVOS.includes(o.estado)
    ).length
    const ordenesActivas = totalDeOrdenesActivas(tecnico)

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
