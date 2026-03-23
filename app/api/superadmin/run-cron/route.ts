import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"

// Importar las funciones de cron directamente
import { GET as engagementCron } from "@/app/api/cron/engagement/route"
import { GET as featureUsageCron } from "@/app/api/cron/feature-usage/route"
import { GET as trialManagementCron } from "@/app/api/cron/trial-management/route"
import { GET as recordatoriosCron } from "@/app/api/cron/recordatorios/route"
import { GET as lifecycleEmailsCron } from "@/app/api/cron/lifecycle-emails/route"

const CRON_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  "/api/cron/engagement": engagementCron,
  "/api/cron/feature-usage": featureUsageCron,
  "/api/cron/trial-management": trialManagementCron,
  "/api/cron/recordatorios": recordatoriosCron,
  "/api/cron/lifecycle-emails": lifecycleEmailsCron,
}

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { path } = await request.json()

    const handler = CRON_HANDLERS[path]
    if (!handler) {
      return NextResponse.json({ error: "Ruta de cron no válida" }, { status: 400 })
    }

    // Crear un request fake con el CRON_SECRET para pasar la autenticación
    const cronSecret = process.env.CRON_SECRET
    const fakeRequest = new Request(request.url, {
      headers: {
        ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
      },
    })

    // Ejecutar el handler directamente (sin fetch)
    const response = await handler(fakeRequest)
    const data = await response.json()

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error("Error running cron:", error)
    return NextResponse.json({ error: "Error al ejecutar cron" }, { status: 500 })
  }
}
