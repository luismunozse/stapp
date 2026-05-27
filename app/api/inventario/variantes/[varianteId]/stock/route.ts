import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// ============================================================
// POST /api/inventario/variantes/[varianteId]/stock
// Wrapper de ajustar_stock_variante_atomic.
// ============================================================

const adjustSchema = z.object({
  mode: z.enum(["absolute", "delta"]),
  value: z.number().int().min(-1_000_000).max(1_000_000),
  motivo: z.string().max(500).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ varianteId: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { varianteId } = await params
    const body = await request.json()
    const { mode, value, motivo } = adjustSchema.parse(body)

    const { data, error: rpcErr } = await supabaseAdmin.rpc("ajustar_stock_variante_atomic", {
      p_variante_id: varianteId,
      p_org: organizationId!,
      p_user: userId!,
      p_mode: mode,
      p_value: value,
      p_motivo: motivo ?? null,
    })

    if (rpcErr) {
      if (rpcErr.code === "P0002") {
        return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 })
      }
      if (rpcErr.code === "P0003") {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      }
      if (rpcErr.code === "22023") {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      }
      throw rpcErr
    }

    const result = data as {
      stock: number
      changed: boolean
      stockAnterior: number
      stockPosterior: number
      movimientoId: string | null
    }

    if (result.changed) {
      revalidateTag("catalogo", "max")
    }

    return NextResponse.json({
      stock: result.stock,
      changed: result.changed,
      stockAnterior: result.stockAnterior,
      stockPosterior: result.stockPosterior,
      movimientoId: result.movimientoId,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error adjusting variante stock:", err)
    return NextResponse.json({ error: "Error al ajustar stock" }, { status: 500 })
  }
}
