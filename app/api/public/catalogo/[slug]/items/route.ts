import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: "Slug inválido" }, { status: 400 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ error: "Catálogo no encontrado" }, { status: 404 })
  }

  const url = new URL(req.url)
  const categoriaId = url.searchParams.get("categoria_id")
  const tipo = url.searchParams.get("tipo")
  const search = url.searchParams.get("q")?.trim()

  let query = supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta,
      imagen_url, imagenes, etiquetas, stock, inventario_id, orden,
      inventario:inventario(stock)
    `)
    .eq("organization_id", config.organization_id)
    .eq("activo", true)
    .order("orden", { ascending: true })

  if (categoriaId) query = query.eq("categoria_id", categoriaId)
  if (tipo === "PRODUCTO" || tipo === "SERVICIO") query = query.eq("tipo", tipo)
  if (search) query = query.ilike("nombre", `%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolver stock real: si linkeado a inventario, source = inventario.stock
  const items = (data ?? []).map((it: any) => {
    const stockReal =
      it.inventario_id && it.inventario
        ? it.inventario.stock
        : it.stock
    const { inventario, ...rest } = it
    return { ...rest, stock_disponible: stockReal }
  })

  return NextResponse.json({ items })
}
