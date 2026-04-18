import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// Endpoint dedicado de ajuste rápido de stock.
// No requiere reenviar el item completo (a diferencia de PUT /api/inventario/[id]).
// Crea automáticamente un movimiento AJUSTE auditable.
const adjustSchema = z.object({
  // Modo "absoluto": setea el stock al valor indicado.
  // Modo "delta": suma/resta al stock actual.
  mode: z.enum(["absolute", "delta"]),
  value: z.number().int(),
  motivo: z.string().max(500).optional(),
  // Tipo de movimiento a registrar. Default AJUSTE; para consolidación de
  // duplicados al crear un item nuevo pasamos "ENTRADA" y referenciaTipo "CONSOLIDACION".
  tipo: z.enum(["AJUSTE", "ENTRADA"]).optional(),
  referenciaTipo: z.string().max(50).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const { mode, value, motivo, tipo, referenciaTipo } = adjustSchema.parse(body)

    // Verificar que el item pertenece a la organización y está activo
    const { data: existingItem, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("id, stock")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !existingItem) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    const stockAnterior = existingItem.stock
    const stockPosterior = mode === "absolute" ? value : stockAnterior + value

    if (stockPosterior < 0) {
      return NextResponse.json(
        { error: "El stock no puede quedar negativo" },
        { status: 400 }
      )
    }

    if (stockPosterior === stockAnterior) {
      return NextResponse.json({ stock: stockAnterior, changed: false })
    }

    const { error: updateError } = await supabaseAdmin
      .from("inventario")
      .update({ stock: stockPosterior, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (updateError) throw updateError

    await supabaseAdmin.from("movimientos_inventario").insert({
      inventario_id: id,
      tipo: tipo || "AJUSTE",
      cantidad: stockPosterior - stockAnterior,
      stock_anterior: stockAnterior,
      stock_posterior: stockPosterior,
      referencia_tipo: referenciaTipo || "AJUSTE_MANUAL",
      observaciones: motivo || "Ajuste rápido desde lista",
      usuario_id: userId,
      organization_id: organizationId,
    })

    return NextResponse.json({ stock: stockPosterior, changed: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error adjusting stock:", error)
    return NextResponse.json(
      { error: "Error al ajustar stock" },
      { status: 500 }
    )
  }
}
