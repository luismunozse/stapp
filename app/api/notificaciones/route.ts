import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { NotificationService, type AlcanceHistorial } from "@/lib/notifications"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { alcanceLecturaOrdenes } from "@/lib/ordenes/alcance-lectura"
import { SUCURSAL_NINGUNA, sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const autenticado = await requireAuth()
    if (autenticado.error) return autenticado.error
    const { organizationId, userId, role, session } = autenticado

    const { searchParams } = new URL(request.url)
    const ordenId = searchParams.get("ordenId")
    const limit = parseInt(searchParams.get("limit") || "50")

    const notificationService = new NotificationService(organizationId!)

    // The history of ONE order, for whoever may open it. Outside that scope it answers like an order
    // that does not exist (an empty history) and the history is never read.
    if (ordenId) {
      const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "leer", { select: "id" })
      if ("error" in cargada) return NextResponse.json([])
      return NextResponse.json(await notificationService.getNotificationHistory(ordenId, limit))
    }

    // The history of the organization: the whole of it for an ADMIN on Todas, otherwise the part that
    // hangs from the orders of the viewer's branch. A technician reads the part that hangs from the
    // orders on his list (so the same notices he can open one by one).
    let alcance: AlcanceHistorial | undefined
    if (role === "TECNICO") {
      const lectura = await alcanceLecturaOrdenes({
        organizationId: organizationId!,
        userId: userId!,
        role,
        sucursalId: session!.user.sucursalId ?? null,
      })
      alcance = { tipo: "lista", lectura }
    } else {
      const lectura = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
      if (!lectura.verTodas) alcance = { tipo: "sucursal", sucursalId: lectura.sucursalId ?? SUCURSAL_NINGUNA }
    }

    return NextResponse.json(await notificationService.getNotificationHistory(undefined, limit, alcance))
  } catch (error) {
    console.error("Error fetching notification history:", error)
    return NextResponse.json(
      { error: "Error al obtener historial" },
      { status: 500 }
    )
  }
}
