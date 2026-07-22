import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const schema = z.object({
  depositoOrigenId: z.string().min(1),
  depositoDestinoId: z.string().min(1),
  cantidad: z.number().int().positive(),
  motivo: z.string().trim().max(500).nullable().optional(),
})

// POST /api/inventario/[id]/transferir
// Wrapper sobre RPC transferir_stock_atomic. Mapea errores ERRCODE
// del trigger a códigos HTTP amigables.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = schema.parse(body)

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc(
      "transferir_stock_atomic",
      {
        p_inventario_id: id,
        p_organization_id: organizationId!,
        p_user_id: userId!,
        p_deposito_origen: data.depositoOrigenId,
        p_deposito_destino: data.depositoDestinoId,
        p_cantidad: data.cantidad,
        p_motivo: data.motivo ?? null,
      }
    )

    if (rpcErr) {
      const code = (rpcErr as any).code
      const msg = rpcErr.message || "Error al transferir"
      if (code === "P0002") {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      if (code === "P0003") {
        return NextResponse.json({ error: msg, code: "INSUFFICIENT_STOCK" }, { status: 409 })
      }
      if (code === "22023") {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw rpcErr
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error transferring stock:", err)
    return NextResponse.json({ error: "Error al transferir stock" }, { status: 500 })
  }
}
