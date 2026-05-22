import { NextResponse } from "next/server"

/**
 * Valida que un request a un endpoint /api/cron/* venga del scheduler
 * autorizado (Vercel cron o superadmin run-cron) usando CRON_SECRET.
 *
 * Falla cerrada: si CRON_SECRET no está definida, devuelve 500.
 * El patrón previo `if (expectedKey && header !== ...)` dejaba el endpoint
 * abierto cuando la env var faltaba en runtime.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const expectedKey = process.env.CRON_SECRET
  if (!expectedKey) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurado en el servidor" },
      { status: 500 }
    )
  }
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  return null
}
