import { NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { enviarPushDeAvisos } from "@/lib/notifications/push-avisos"

// Cron cada minuto: manda como push los avisos (user_notifications) que todavía
// no salieron, sin importar quién los escribió.
//
// Auth: Bearer ${CRON_SECRET}
//
// La lógica vive en lib/notifications/push-avisos.ts para poder testearla sin la ruta.

export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const result = await enviarPushDeAvisos()
    if (result.error) {
      return NextResponse.json({ error: "Error reclamando avisos para push", ...result }, { status: 500 })
    }
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron de avisos-push:", error)
    return NextResponse.json({ error: "Error enviando push de avisos" }, { status: 500 })
  }
}
