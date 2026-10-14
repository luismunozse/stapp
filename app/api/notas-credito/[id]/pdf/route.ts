import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { cargarDocumentoNC, NC_NO_ENCONTRADA } from "@/lib/notas-credito/documento"
import { respuestaPdfNotaCredito } from "@/lib/notas-credito/pdf"

/**
 * GET /api/notas-credito/[id]/pdf — el PDF A4 de cualquier NC (de venta, de
 * orden o del historial DEV-). Lo ve quien ve la operación de origen: el
 * alcance lo aplica cargarDocumentoNC.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const { id } = await params
    const doc = await cargarDocumentoNC(id, {
      organizationId: organizationId!,
      userId: userId!,
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!doc) return NextResponse.json({ error: NC_NO_ENCONTRADA }, { status: 404 })

    return await respuestaPdfNotaCredito(doc)
  } catch (err) {
    console.error("Error generando PDF de nota de credito:", err)
    return NextResponse.json({ error: "Error al generar el PDF de la nota de crédito" }, { status: 500 })
  }
}
