import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// PATCH /api/inventario/lotes/[loteId]
// Edita campos seguros: notas, fecha_vencimiento (solo si cantidad_inicial == cantidad_actual o
// estado != AGOTADO/VENCIDO; relajado a "siempre editable" para casos de corrección administrativa),
// estado (para bloquear/desbloquear).
const patchSchema = z.object({
  notas: z.string().trim().max(500).nullable().optional(),
  fechaVencimiento: z.string().trim().nullable().optional(),
  estado: z.enum(["ACTIVO", "BLOQUEADO"]).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ loteId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { loteId } = await params
    const body = await request.json()
    const data = patchSchema.parse(body)

    // Verificar pertenencia
    const { data: lote, error: getErr } = await supabaseAdmin
      .from("inventario_lotes")
      .select("id, estado")
      .eq("id", loteId)
      .eq("organization_id", organizationId!)
      .single()

    if (getErr || !lote) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 })
    }

    // Bloquear edición de notas/venc si está VENCIDO o AGOTADO (sólo permitir desbloquear)
    if (
      (lote.estado === "VENCIDO" || lote.estado === "AGOTADO") &&
      (data.notas !== undefined || data.fechaVencimiento !== undefined)
    ) {
      return NextResponse.json(
        { error: "No se puede editar un lote vencido/agotado" },
        { status: 400 }
      )
    }

    const update: Record<string, unknown> = {}
    if (data.notas !== undefined) update.notas = data.notas
    if (data.fechaVencimiento !== undefined)
      update.fecha_vencimiento = data.fechaVencimiento || null
    if (data.estado !== undefined) update.estado = data.estado

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Sin cambios" }, { status: 400 })
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("inventario_lotes")
      .update(update)
      .eq("id", loteId)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (upErr) throw upErr

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error patching lote:", err)
    return NextResponse.json({ error: "Error al actualizar lote" }, { status: 500 })
  }
}
