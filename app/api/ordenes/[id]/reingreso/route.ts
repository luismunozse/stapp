import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { reingresoDesdeOrden } from "@/lib/garantias/reclamos"
import { esErrorReclamo } from "@/lib/garantias/errores"

const reingresoSchema = z.object({
  problemaReportado: z.string().trim().min(1, "Contá qué problema trae el equipo").max(2000),
  /** Solo si la garantía venció: el ADMIN la fuerza dejando el motivo. */
  motivoFueraDeVigencia: z.string().trim().max(1000).optional().nullable(),
})

/**
 * POST /api/ordenes/[id]/reingreso — "Re-ingreso por garantía" del menú de la
 * orden (solo ADMIN). Es un atajo del flujo de reclamos: registra el reclamo
 * sobre la garantía de la orden y lo acepta en un paso, con el mismo camino
 * que crea cualquier re-ingreso (lib/garantias/reclamos → aceptarReclamo).
 * Valida la garantía vigente; vencida, solo con motivo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId, role } = autenticado
    if (error) return error

    const { id: ordenOrigenId } = await params

    // The re-entry is created for the origin order's client, so it takes the
    // client-facing side ("comercial"). Out of scope answers like a missing order.
    const cargada = await cargarOrdenEnAlcance(ordenOrigenId, actorDeSesion(autenticado), "comercial", {
      select: "id, estado",
      noEncontrada: "Orden original no encontrada",
    })
    if ("error" in cargada) return cargada.error

    // Aceptar un reclamo es del ADMIN (decisión 3 del dueño). El resto registra
    // el reclamo desde la tarjeta de garantía.
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede crear un re-ingreso por garantía. Registrá un reclamo desde la tarjeta de garantía.", code: "SOLO_ADMIN" },
        { status: 403 }
      )
    }

    // After the scope check, so a practice order of another branch is "not found" too.
    const practica = await rejectIfPractica(ordenOrigenId, organizationId!)
    if (practica) return practica

    const data = reingresoSchema.parse(await request.json())

    const { reclamo, orden } = await reingresoDesdeOrden({
      organizationId: organizationId!,
      actor: { userId: userId!, role },
      ordenId: ordenOrigenId,
      descripcion: data.problemaReportado,
      motivoFueraDeVigencia: data.motivoFueraDeVigencia ?? null,
      request,
    })

    return NextResponse.json(
      {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        codigoOrden: orden.codigo_orden,
        reclamoId: reclamo.id,
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 })
    }
    if (esErrorReclamo(err)) return err.toResponse()
    console.error("Error creating reingreso:", err)
    return NextResponse.json({ error: "Error al crear re-ingreso" }, { status: 500 })
  }
}
