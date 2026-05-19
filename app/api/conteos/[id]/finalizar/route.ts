import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const schema = z.object({
  forzar: z.boolean().optional(),
})

// POST /api/conteos/[id]/finalizar
// Aplica ajustes (si aplicar_ajustes=true) y marca el conteo como FINALIZADO.
// forzar=true permite finalizar con items pendientes sin contar.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const data = schema.parse(body)

    const { data: existing } = await supabaseAdmin
      .from("conteos_inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!existing) {
      return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 })
    }

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc("finalizar_conteo", {
      p_conteo_id: id,
      p_user_id: userId!,
      p_forzar: data.forzar ?? false,
    })

    if (rpcErr) {
      const code = (rpcErr as any).code
      if (code === "22023") {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      }
      if (code === "P0002") {
        return NextResponse.json({ error: rpcErr.message }, { status: 404 })
      }
      throw rpcErr
    }

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error finalizing conteo:", err)
    return NextResponse.json({ error: "Error al finalizar conteo" }, { status: 500 })
  }
}
