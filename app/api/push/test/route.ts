import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { sendPushToUser } from "@/lib/push/send"

// Send a self-test notification to the calling user. Used by the settings UI
// "Probar" button so users verify their device receives pushes.

export async function POST() {
  const { error, userId } = await requireAuth()
  if (error) return error

  const result = await sendPushToUser(userId!, {
    title: "STApp",
    body: "Notificaciones activas. Te avisaremos cuando haya novedades.",
    path: "/dashboard",
    tag: "self-test",
  })

  if (result.sent === 0 && result.skipped > 0) {
    return NextResponse.json(
      {
        error: "Push no configurado en el servidor",
        details: result.errors,
      },
      { status: 503 }
    )
  }

  if (result.sent === 0 && result.failed > 0) {
    return NextResponse.json(
      {
        error: "No se pudo entregar la notificación",
        details: result.errors,
      },
      { status: 502 }
    )
  }

  if (result.sent === 0) {
    return NextResponse.json(
      { error: "No hay dispositivos registrados para tu usuario" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    success: true,
    sent: result.sent,
    byTransport: result.byTransport,
  })
}
