import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// PATCH /api/inventario/series/[serieId]
// Edita campos seguros sin afectar stock:
//   - estado (BLOQUEADO / DISPONIBLE / DEVUELTO)
//   - notas
//   - fecha_garantia_vence
const patchSchema = z.object({
  estado: z
    .enum(["DISPONIBLE", "RESERVADO", "VENDIDO", "GARANTIA_ACTIVA", "DEVUELTO", "BLOQUEADO"])
    .optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  fechaGarantiaVence: z.string().trim().nullable().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serieId: string }> }
) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { serieId } = await params
    const body = await request.json()
    const data = patchSchema.parse(body)

    const { data: serie, error: getErr } = await supabaseAdmin
      .from("inventario_series")
      .select("id, estado")
      .eq("id", serieId)
      .eq("organization_id", organizationId!)
      .single()

    if (getErr || !serie) {
      return NextResponse.json({ error: "Serie no encontrada" }, { status: 404 })
    }

    const update: Record<string, unknown> = {}
    if (data.estado !== undefined) update.estado = data.estado
    if (data.notas !== undefined) update.notas = data.notas
    if (data.fechaGarantiaVence !== undefined)
      update.fecha_garantia_vence = data.fechaGarantiaVence || null

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Sin cambios" }, { status: 400 })
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("inventario_series")
      .update(update)
      .eq("id", serieId)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (upErr) throw upErr

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error patching serie:", err)
    return NextResponse.json({ error: "Error al actualizar serie" }, { status: 500 })
  }
}
