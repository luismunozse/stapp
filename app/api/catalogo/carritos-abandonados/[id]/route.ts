import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const patchSchema = z.object({
  action: z.enum(["mark_contacted", "discard"]),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 })
  }

  if (parsed.data.action === "discard") {
    const { error } = await supabaseAdmin
      .from("catalogo_carritos_abandonados")
      .delete()
      .eq("id", id)
      .eq("organization_id", auth.organizationId!)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // mark_contacted
  const { data, error } = await supabaseAdmin
    .from("catalogo_carritos_abandonados")
    .update({
      contacted_at: new Date().toISOString(),
      contacted_by: auth.userId ?? null,
    })
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ carrito: data })
}
