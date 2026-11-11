import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { decidirReclamo } from "@/lib/garantias/reclamos"
import { formatReclamo } from "@/lib/garantias/formato"
import { esErrorReclamo } from "@/lib/garantias/errores"

const decisionSchema = z.object({
  accion: z.enum(["aceptar", "rechazar"]),
  motivo: z.string().trim().max(1000).optional().nullable(),
})

/**
 * PUT /api/garantias/reclamos/[id] — decidir un reclamo (solo ADMIN).
 *   { accion: "aceptar" }                → ACEPTADO + orden de re-ingreso vinculada
 *   { accion: "rechazar", motivo: "…" }  → RECHAZADO (el motivo es obligatorio)
 * RESUELTO no se pide: lo pone la entrega del re-ingreso.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error
    // El rol antes de leer nada: cualquier otro recibe el mismo 403 para cualquier id.
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede aceptar o rechazar reclamos.", code: "SOLO_ADMIN" },
        { status: 403 }
      )
    }

    const { id } = await params
    const data = decisionSchema.parse(await request.json())
    const { reclamo, orden } = await decidirReclamo({
      organizationId: organizationId!,
      actor: { userId: userId!, role },
      reclamoId: id,
      accion: data.accion,
      motivo: data.motivo ?? null,
      request,
    })
    return NextResponse.json({
      reclamo: formatReclamo(reclamo),
      orden: orden
        ? { id: orden.id, numeroOrden: orden.numero_orden, codigoOrden: orden.codigo_orden }
        : null,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 })
    }
    if (esErrorReclamo(err)) return err.toResponse()
    console.error("Error decidiendo el reclamo de garantía:", err)
    return NextResponse.json({ error: "Error al actualizar el reclamo" }, { status: 500 })
  }
}
