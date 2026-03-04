import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = "force-dynamic"

export async function GET() {
  const start = Date.now()

  // Verificar conectividad con la base de datos
  let dbStatus: "ok" | "error" = "error"
  let dbLatencyMs = 0

  try {
    const dbStart = Date.now()
    const { error } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .limit(1)
    dbLatencyMs = Date.now() - dbStart
    dbStatus = error ? "error" : "ok"
  } catch {
    dbStatus = "error"
  }

  const healthy = dbStatus === "ok"

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: {
          status: dbStatus,
          latency_ms: dbLatencyMs,
        },
      },
      version: process.env.npm_package_version || "0.1.0",
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  )
}
