import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"

/** GET /api/moneda/tipo-cambio: cotización vigente de la org. Cualquier rol autenticado. */
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const resultado = await resolverTipoCambio(organizationId!)
    return NextResponse.json(resultado, { headers: { "Cache-Control": "private, max-age=60" } })
  } catch (e) {
    console.error("[tipo-cambio] error:", e)
    return NextResponse.json({ error: "Error al obtener la cotización" }, { status: 500 })
  }
}
