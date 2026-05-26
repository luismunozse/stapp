import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const itemSchema = z.object({
  tipo: z.enum(["PRODUCTO", "SERVICIO"]),
  nombre: z.string().min(1).max(160),
  descripcion: z.string().max(2000).nullable().optional(),
  categoria_id: z.string().nullable().optional(),
  inventario_id: z.string().nullable().optional(),
  precio: z.number().min(0).nullable().optional(),
  precio_hasta: z.number().min(0).nullable().optional(),
  precio_lista: z.number().min(0).nullable().optional(),
  imagen_url: z.string().url().nullable().optional(),
  imagenes: z.array(z.string().url()).optional(),
  etiquetas: z.array(z.string().max(40)).optional(),
  stock: z.number().int().min(0).nullable().optional(),
  destacado: z.boolean().optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
})

export async function GET(req: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const categoriaId = url.searchParams.get("categoria_id")
  const tipo = url.searchParams.get("tipo")
  const search = url.searchParams.get("q")?.trim()

  let query = supabaseAdmin
    .from("catalogo_items")
    .select("*, categoria:catalogo_categorias(id,nombre), inventario:inventario(id,stock,nombre)")
    .eq("organization_id", auth.organizationId!)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: false })

  if (categoriaId) query = query.eq("categoria_id", categoriaId)
  if (tipo === "PRODUCTO" || tipo === "SERVICIO") query = query.eq("tipo", tipo)
  if (search) query = query.ilike("nombre", `%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = itemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  if (d.tipo === "SERVICIO" && d.stock != null) {
    return NextResponse.json({ error: "Servicios no tienen stock" }, { status: 400 })
  }

  if (d.precio_hasta != null && d.precio != null && d.precio_hasta < d.precio) {
    return NextResponse.json({ error: "precio_hasta debe ser mayor o igual a precio" }, { status: 400 })
  }

  if (d.categoria_id) {
    const { data: cat } = await supabaseAdmin
      .from("catalogo_categorias")
      .select("id")
      .eq("id", d.categoria_id)
      .eq("organization_id", auth.organizationId!)
      .maybeSingle()
    if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 400 })
  }

  if (d.inventario_id) {
    const { data: inv } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", d.inventario_id)
      .eq("organization_id", auth.organizationId!)
      .maybeSingle()
    if (!inv) return NextResponse.json({ error: "Item de inventario no encontrado" }, { status: 400 })
  }

  const { data: maxOrden } = await supabaseAdmin
    .from("catalogo_items")
    .select("orden")
    .eq("organization_id", auth.organizationId!)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrden = d.orden ?? ((maxOrden?.orden ?? -1) + 1)

  const { data, error } = await supabaseAdmin
    .from("catalogo_items")
    .insert({
      organization_id: auth.organizationId!,
      tipo: d.tipo,
      nombre: d.nombre,
      descripcion: d.descripcion ?? null,
      categoria_id: d.categoria_id ?? null,
      inventario_id: d.inventario_id ?? null,
      precio: d.precio ?? null,
      precio_hasta: d.precio_hasta ?? null,
      precio_lista: d.precio_lista ?? null,
      imagen_url: d.imagen_url ?? null,
      imagenes: d.imagenes ?? [],
      etiquetas: d.etiquetas ?? [],
      stock: d.stock ?? null,
      destacado: d.destacado ?? false,
      activo: d.activo ?? true,
      orden: nextOrden,
    })
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateTag("catalogo", "max")
  return NextResponse.json({ item: data }, { status: 201 })
}
