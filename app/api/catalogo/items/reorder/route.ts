import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidateCatalogo } from "@/lib/catalogo/revalidate"
import { z } from "zod"

const reorderSchema = z.object({
  orden: z.array(z.object({
    id: z.string(),
    orden: z.number().int().min(0),
  })).min(1),
})

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = reorderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const updates = parsed.data.orden.map((item) =>
    supabaseAdmin
      .from("catalogo_items")
      .update({ orden: item.orden })
      .eq("id", item.id)
      .eq("organization_id", auth.organizationId!)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  await revalidateCatalogo(auth.organizationId!)
  return NextResponse.json({ ok: true })
}
