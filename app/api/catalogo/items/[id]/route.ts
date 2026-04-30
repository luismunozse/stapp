import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  tipo: z.enum(["PRODUCTO", "SERVICIO"]).optional(),
  nombre: z.string().min(1).max(160).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
  categoria_id: z.string().nullable().optional(),
  inventario_id: z.string().nullable().optional(),
  precio: z.number().min(0).nullable().optional(),
  precio_hasta: z.number().min(0).nullable().optional(),
  imagen_url: z.string().url().nullable().optional(),
  imagenes: z.array(z.string().url()).optional(),
  etiquetas: z.array(z.string().max(40)).optional(),
  stock: z.number().int().min(0).nullable().optional(),
  destacado: z.boolean().optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
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

  const { data: existing } = await supabaseAdmin
    .from("catalogo_items")
    .select("tipo, precio, precio_hasta")
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })

  const tipoFinal = parsed.data.tipo ?? existing.tipo
  if (tipoFinal === "SERVICIO" && parsed.data.stock != null) {
    return NextResponse.json({ error: "Servicios no tienen stock" }, { status: 400 })
  }

  const precioFinal = parsed.data.precio !== undefined ? parsed.data.precio : existing.precio
  const precioHastaFinal = parsed.data.precio_hasta !== undefined ? parsed.data.precio_hasta : existing.precio_hasta
  if (precioHastaFinal != null && precioFinal != null && precioHastaFinal < precioFinal) {
    return NextResponse.json({ error: "precio_hasta debe ser mayor o igual a precio" }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from("catalogo_items")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateTag("catalogo", "max")
  return NextResponse.json({ item: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const { error } = await supabaseAdmin
    .from("catalogo_items")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateTag("catalogo", "max")
  return NextResponse.json({ ok: true })
}
