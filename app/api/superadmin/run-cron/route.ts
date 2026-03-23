import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"

const ALLOWED_CRONS = [
  "/api/cron/engagement",
  "/api/cron/feature-usage",
  "/api/cron/trial-management",
  "/api/cron/recordatorios",
  "/api/cron/lifecycle-emails",
]

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { path } = await request.json()

    if (!path || !ALLOWED_CRONS.includes(path)) {
      return NextResponse.json({ error: "Ruta de cron no válida" }, { status: 400 })
    }

    const cronSecret = process.env.CRON_SECRET
    const baseUrl = request.nextUrl.origin

    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json({ error: data.error || "Error ejecutando cron", ...data }, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error running cron:", error)
    return NextResponse.json({ error: "Error al ejecutar cron" }, { status: 500 })
  }
}
