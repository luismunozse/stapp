import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"
import { VALID_CRON_PATHS } from "@/lib/cron-config"

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
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, z.object({ path: z.string().min(1) }))
    if ("error" in parsed) return parsed.error

    const { path } = parsed.data
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

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email || null, request)
    auditLogger.cronRun(path, response.ok).catch(() => {})

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error("Error running cron:", error)
    return NextResponse.json({ error: "Error al ejecutar cron" }, { status: 500 })
  }
}
