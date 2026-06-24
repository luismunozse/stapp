import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = "force-dynamic"

export async function GET() {
  // Verificar conectividad con la base de datos
  let dbStatus: "ok" | "error" = "error"

  try {
    const { error } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .limit(1)
    dbStatus = error ? "error" : "ok"
  } catch {
    dbStatus = "error"
  }

  const healthy = dbStatus === "ok"

  // Respuesta minima: este endpoint es anonimo. No exponer version (facilita
  // targeting de CVEs), uptime (revela antiguedad del deploy) ni latencia de DB.
  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        database: { status: dbStatus },
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  )
}
