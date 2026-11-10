import { NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWhatsAppHealthCheck } from "@/lib/whatsapp/health"

// El glob general de vercel.json (app/api/**) deja 30 s; los cron van a 60 s.
export const maxDuration = 60

// Cron horario: refresca el estado real de las instancias de WhatsApp y alerta.
//
// Auth: Bearer ${CRON_SECRET}
//
// La lógica vive en lib/whatsapp/health.ts para poder testearla sin la ruta.

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const result = await runWhatsAppHealthCheck()
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron de whatsapp-health:", error)
    return NextResponse.json({ error: "Error chequeando instancias de WhatsApp" }, { status: 500 })
  }
}
