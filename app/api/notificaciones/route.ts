import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { NotificationService } from "@/lib/notifications"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const ordenId = searchParams.get("ordenId")
    const limit = parseInt(searchParams.get("limit") || "50")

    const notificationService = new NotificationService(organizationId!)
    const history = await notificationService.getNotificationHistory(
      ordenId || undefined,
      limit
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
