import { NextResponse } from "next/server"
import { getOrderByPublicToken } from "@/lib/public-token"
import { listarDanosOrden } from "@/lib/ordenes/danos-server"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { orden, error } = await getOrderByPublicToken(token)
    if (error) return error

    const { danos, sinDanos, diagrama } = await listarDanosOrden(orden.id, orden.organization_id, {
      incluirAutor: false,
    })

    // Página pública: nunca se expone el autor del pin.
    const publicos = danos.map(({ createdByNombre: _autor, ...resto }) => resto)

    return NextResponse.json({ danos: publicos, sinDanos, diagrama })
  } catch (error) {
    console.error("Error fetching danos:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
