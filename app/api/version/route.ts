import { NextResponse } from "next/server"

// Devuelve el build-id de ESTE deployment. Cada deploy de Vercel tiene su
// propio valor inyectado en build, así que una pestaña vieja (que cargó con un
// build-id anterior) recibe acá el build-id nuevo y detecta que hay versión
// nueva. Sin auth: no expone nada sensible.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store" } }
  )
}
