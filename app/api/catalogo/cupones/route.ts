import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const cuponSchema = z.object({
  codigo: z.string().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/, "Solo letras, números, guion y guion bajo"),
  descripcion: z.string().max(280).nullable().optional(),
  tipo: z.enum(["porcentaje", "monto"]),
  valor: z.number().positive(),
  min_compra: z.number().min(0).nullable().optional(),
  max_usos: z.number().int().positive().nullable().optional(),
  fecha_inicio: z.string().datetime().nullable().optional(),
  fecha_fin: z.string().datetime().nullable().optional(),
  activo: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { data, error } = await supabaseAdmin
    .from("catalogo_cupones")
    .select("*")
    .eq("organization_id", auth.organizationId!)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cupones: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = cuponSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  if (d.tipo === "porcentaje" && d.valor > 100) {
    return NextResponse.json({ error: "Porcentaje no puede superar 100" }, { status: 400 })
  }
  if (d.fecha_inicio && d.fecha_fin && new Date(d.fecha_fin) < new Date(d.fecha_inicio)) {
    return NextResponse.json({ error: "fecha_fin debe ser posterior a fecha_inicio" }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from("catalogo_cupones")
    .insert({
      organization_id: auth.organizationId!,
      codigo: d.codigo.toUpperCase(),
      descripcion: d.descripcion ?? null,
      tipo: d.tipo,
      valor: d.valor,
      min_compra: d.min_compra ?? null,
      max_usos: d.max_usos ?? null,
      fecha_inicio: d.fecha_inicio ?? null,
      fecha_fin: d.fecha_fin ?? null,
      activo: d.activo ?? true,
    })
    .select("*")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un cupón con ese código" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cupon: data }, { status: 201 })
}
