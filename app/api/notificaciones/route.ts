import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { NotificationService } from "@/lib/notifications"
import { ordenEnAlcance, resolverAlcanceOrdenesDeSesion, resolverAlcanceOrdenesPorId } from "@/lib/ordenes/alcance-lectura"

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const ordenId = searchParams.get("ordenId")
    const limit = parseInt(searchParams.get("limit") || "50")

    // The history shows the order number and the customer of each row, so it
    // follows the caller's order read scope.
    // A lookup by ?ordenId= is a by-id access (the switcher is ignored for ADMIN);
    // the history list without it is a list (the switcher narrows ADMIN).
    const resolver = ordenId ? resolverAlcanceOrdenesPorId : resolverAlcanceOrdenesDeSesion
    const alcance = await resolver({
      role,
      userId,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    if (ordenId && alcance.tipo !== "todas") {
      // A missing order and one out of scope answer the same.
      const { data: orden } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("sucursal_id, tecnico_id")
        .eq("id", ordenId)
        .eq("organization_id", organizationId!)
        .single()
      if (!ordenEnAlcance(alcance, orden)) {
        return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
      }
    }

    const notificationService = new NotificationService(organizationId!)
    const history = await notificationService.getNotificationHistory(
      ordenId || undefined,
      limit,
      alcance
    )

    return NextResponse.json(history)
  } catch (error) {
    console.error("Error fetching notification history:", error)
    return NextResponse.json(
      { error: "Error al obtener historial" },
      { status: 500 }
    )
  }
}
