import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { resolverAlcanceOrdenesPorId } from "@/lib/ordenes/alcance-lectura"
import { garantiasConReclamos, registrarReclamo } from "@/lib/garantias/reclamos"
import { formatReclamo } from "@/lib/garantias/formato"
import { esErrorReclamo } from "@/lib/garantias/errores"

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Id inválido")

const registroSchema = z.object({
  origen: z.enum(["REPARACION", "VENTA"]),
  garantiaId: ID,
  descripcion: z.string().trim().min(1, "Contá qué problema tiene el equipo o producto.").max(2000),
  motivoFueraDeVigencia: z.string().trim().max(1000).optional().nullable(),
})

/**
 * GET /api/garantias/reclamos?ordenId=… | ?ventaId=…
 * Las garantías de la orden o de la venta con su estado derivado y la línea
 * de tiempo de reclamos. Mismo alcance que /garantias (lo abre por id).
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const sp = new URL(request.url).searchParams
    const ordenId = sp.get("ordenId")
    const ventaId = sp.get("ventaId")
    const id = ventaId ?? ordenId
    if (!id || !ID.safeParse(id).success) {
      return NextResponse.json({ error: "Indicá ordenId o ventaId" }, { status: 400 })
    }

    const alcance = await resolverAlcanceOrdenesPorId({
      role,
      userId,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const garantias = await garantiasConReclamos({
      organizationId: organizationId!,
      alcance,
      actor: { role, userId },
      ordenId: ventaId ? null : ordenId,
      ventaId,
    })
    return NextResponse.json({ garantias })
  } catch (err) {
    if (esErrorReclamo(err)) return err.toResponse()
    console.error("Error leyendo los reclamos de garantía:", err)
    return NextResponse.json({ error: "Error al obtener los reclamos" }, { status: 500 })
  }
}

/**
 * POST /api/garantias/reclamos — registrar un reclamo (cualquier rol, sobre
 * una garantía de su alcance). Body: { origen, garantiaId, descripcion,
 * motivoFueraDeVigencia? }. Una garantía vencida solo la reclama el ADMIN con
 * motivo (400 GARANTIA_VENCIDA con requiereMotivo).
 */
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const data = registroSchema.parse(await request.json())
    const alcance = await resolverAlcanceOrdenesPorId({
      role,
      userId,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const { reclamo } = await registrarReclamo({
      organizationId: organizationId!,
      actor: { userId: userId!, role: role! },
      alcance,
      origen: data.origen,
      garantiaId: data.garantiaId,
      descripcion: data.descripcion,
      motivoFueraDeVigencia: data.motivoFueraDeVigencia ?? null,
    })
    return NextResponse.json(formatReclamo(reclamo), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 })
    }
    if (esErrorReclamo(err)) return err.toResponse()
    console.error("Error registrando el reclamo de garantía:", err)
    return NextResponse.json({ error: "Error al registrar el reclamo" }, { status: 500 })
  }
}
