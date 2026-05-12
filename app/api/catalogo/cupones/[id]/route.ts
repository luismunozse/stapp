import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  descripcion: z.string().max(280).nullable().optional(),
  tipo: z.enum(["porcentaje", "monto"]).optional(),
  valor: z.number().positive().optional(),
  min_compra: z.number().min(0).nullable().optional(),
  max_usos: z.number().int().positive().nullable().optional(),
  fecha_inicio: z.string().datetime().nullable().optional(),
  fecha_fin: z.string().datetime().nullable().optional(),
  activo: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  if (d.tipo === "porcentaje" && d.valor != null && d.valor > 100) {
    return NextResponse.json({ error: "Porcentaje no puede superar 100" }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from("catalogo_cupones")
    .update(d)
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Cupón no encontrado" }, { status: 404 })
  return NextResponse.json({ cupon: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const { error } = await supabaseAdmin
    .from("catalogo_cupones")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
