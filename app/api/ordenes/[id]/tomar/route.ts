import { NextResponse } from "next/server"
import { requireAuth, resolveTecnicosTomanOrdenes } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { ordenSeTomaPorTecnico } from "@/lib/ordenes/tomar"

// POST /api/ordenes/[id]/tomar
//
// A TECNICO picks up an unassigned order for HIMSELF. Opt-in per organization
// (`tecnicos_toman_ordenes`, migration 374), fail-closed. This is a dedicated
// endpoint on purpose: the generic PUT keeps its "only your own orders" guard,
// so this permission can never be used to reassign or un-assign anything.
//
// The write is conditional on `tecnico_id IS NULL`, so two technicians taking
// the same order race on the database, not on a read-then-write in this
// handler: the loser matches no row and gets 409.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId, role } = autenticado
    if (error) return error

    // ADMIN assigns through PUT /api/ordenes/[id]; nobody else takes orders.
    if (role !== "TECNICO") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    // The body is optional. If it names a technician it can only be the caller:
    // anything else (another user, or null) is an attempt to assign someone
    // else or to un-assign, which this endpoint never does.
    let body: Record<string, unknown> = {}
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>
    } catch {
      // empty body is fine
    }
    if ("tecnicoId" in body && body.tecnicoId !== userId) {
      return NextResponse.json({ error: "Solo puedes tomar una orden para ti" }, { status: 403 })
    }

    if (!(await resolveTecnicosTomanOrdenes(organizationId!))) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const { id } = await params

    // Same scope as the orders list and the detail: a technician does not reach into
    // another branch's orders, so one of another branch is "not found" (the same
    // answer a missing id gets). One assigned to him is in scope, and then already taken.
    // The flag was read above: pass it on instead of reading it again.
    const cargada = await cargarOrdenEnAlcance(id, actorDeSesion(autenticado), "ver", {
      select: "id, tecnico_id, estado, sucursal_id",
      tomaSinAsignar: true,
    })
    if ("error" in cargada) return cargada.error
    const { orden } = cargada

    if (orden.tecnico_id) {
      return NextResponse.json(
        { error: "La orden ya tiene un técnico asignado" },
        { status: 409 }
      )
    }
    if (!ordenSeTomaPorTecnico(orden)) {
      return NextResponse.json(
        { error: "No se puede tomar una orden cerrada" },
        { status: 409 }
      )
    }

    // Same snapshot the generic assignment path takes (commission % and labor
    // rate at assignment time).
    const { data: tecnico } = await supabaseAdmin
      .from("users")
      .select("id, rol, porcentaje_comision, costo_hora")
      .eq("id", userId!)
      .eq("organization_id", organizationId!)
      .single()

    if (!tecnico || tecnico.rol !== "TECNICO") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const { data: tomada, error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        tecnico_id: userId!,
        porcentaje_comision: Number(tecnico.porcentaje_comision ?? 0),
        costo_hora_snapshot: Number(tecnico.costo_hora ?? 0),
      })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("tecnico_id", null)
      .select("id")
      .maybeSingle()

    if (updateError) throw updateError

    // No row matched: somebody took it between our read and our write.
    if (!tomada) {
      return NextResponse.json(
        { error: "La orden ya tiene un técnico asignado" },
        { status: 409 }
      )
    }

    try {
      await createAuditLogger(organizationId!, userId!, request).update(
        "ordenes_servicio",
        id,
        { tecnico_id: null },
        { tecnico_id: userId }
      )
    } catch (err) {
      console.error("Error logging audit for tomar orden:", err)
    }

    return NextResponse.json({ id, tecnicoId: userId })
  } catch (error) {
    console.error("Error taking orden:", error)
    return NextResponse.json({ error: "Error al tomar la orden" }, { status: 500 })
  }
}
