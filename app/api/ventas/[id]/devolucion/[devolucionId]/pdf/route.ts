import { NextResponse } from "next/server"
import { requirePosAccess } from "@/lib/auth-utils"
import { cargarDocumentoNC } from "@/lib/notas-credito/documento"
import { respuestaPdfNotaCredito } from "@/lib/notas-credito/pdf"

/**
 * GET /api/ventas/[id]/devolucion/[devolucionId]/pdf — el PDF de una
 * devolución (nota de crédito del motor de ventas). Mismo documento que
 * /api/notas-credito/[id]/pdf; esta URL se conserva para los links que ya
 * existen. requirePosAccess queda adelante, como siempre tuvo esta ruta.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; devolucionId: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requirePosAccess()
    if (error) return error

    const { id, devolucionId } = await params
    const doc = await cargarDocumentoNC(devolucionId, {
      organizationId: organizationId!,
      userId: userId!,
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    // La URL nombra la venta: la NC tiene que ser de ESA venta.
    if (!doc || doc.origen !== "VENTA" || doc.origenId !== id) {
      return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 })
    }

    return await respuestaPdfNotaCredito(doc)
  } catch (error) {
    console.error("Error generating devolucion PDF:", error)
    return NextResponse.json({ error: "Error al generar PDF de devolución" }, { status: 500 })
  }
}
