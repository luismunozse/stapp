import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const patchSchema = z.object({
  stockContado: z.number().int().min(0).nullable(),
  observaciones: z.string().trim().max(500).nullable().optional(),
})

// PATCH /api/conteos/[id]/items/[itemId]
// Carga stock contado para un item. stockContado=null limpia el conteo previo.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
        // La unica ESCRITURA del namespace que se habia escapado del permiso
    // 275: anotar la cantidad contada de un item. Crear el conteo,
    // cancelarlo y finalizarlo —que es lo que ajusta el stock— siguen
    // siendo de ADMIN; recorrer las gondolas y anotar, no.
const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { id, itemId } = await params
    const body = await request.json()
    const data = patchSchema.parse(body)

    // Verificar conteo en progreso y pertenencia
    const { data: conteo } = await supabaseAdmin
      .from("conteos_inventario")
      .select("id, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!conteo) {
      return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 })
    }
    if (conteo.estado !== "EN_PROGRESO") {
      return NextResponse.json(
        { error: `Conteo no editable (estado: ${conteo.estado})` },
        { status: 400 }
      )
    }

    const updateData: Record<string, any> = {
      stock_contado: data.stockContado,
      contado_por: data.stockContado === null ? null : userId,
      contado_at: data.stockContado === null ? null : new Date().toISOString(),
    }
    if (data.observaciones !== undefined) {
      updateData.observaciones = data.observaciones
    }

    const { data: row, error: updErr } = await supabaseAdmin
      .from("conteos_items")
      .update(updateData)
      .eq("id", itemId)
      .eq("conteo_id", id)
      .eq("organization_id", organizationId!)
      .select("id, stock_sistema, stock_contado, diferencia, observaciones, contado_at")
      .single()

    if (updErr || !row) {
      return NextResponse.json({ error: "Item no encontrado en este conteo" }, { status: 404 })
    }

    return NextResponse.json({
      id: row.id,
      stockSistema: row.stock_sistema,
      stockContado: row.stock_contado,
      diferencia: row.diferencia,
      observaciones: row.observaciones,
      contadoAt: row.contado_at,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating conteo item:", err)
    return NextResponse.json({ error: "Error al actualizar item" }, { status: 500 })
  }
}
