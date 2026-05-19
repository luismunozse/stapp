import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const schema = z.object({
  cantidad: z.number().int().positive(),
  depositoId: z.string().min(1).nullable().optional(),
  motivo: z.string().trim().max(500).nullable().optional(),
})

// POST /api/inventario/[id]/kit/ensamblar
// Wrapper de ensamblar_kit_atomic.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = schema.parse(body)

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc(
      "ensamblar_kit_atomic",
      {
        p_kit_id: id,
        p_cantidad_a_ensamblar: data.cantidad,
        p_org_id: organizationId!,
        p_user_id: userId!,
        p_deposito_id: data.depositoId ?? null,
        p_motivo: data.motivo ?? null,
      }
    )

    if (rpcErr) {
      const code = (rpcErr as { code?: string }).code
      const msg = rpcErr.message || "Error al ensamblar kit"
      if (code === "P0002") {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      if (code === "P0003") {
        return NextResponse.json(
          { error: msg, code: "INSUFFICIENT_STOCK" },
          { status: 409 }
        )
      }
      if (code === "22023") {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw rpcErr
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error ensamblando kit:", err)
    return NextResponse.json(
      { error: "Error al ensamblar kit" },
      { status: 500 }
    )
  }
}
