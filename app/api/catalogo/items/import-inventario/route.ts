import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const importSchema = z.object({
  inventarioIds: z.array(z.string()).min(1).max(500),
  categoriaId: z.string().nullable().optional(),
  activo: z.boolean().optional(),
  destacado: z.boolean().optional(),
})

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = importSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const orgId = auth.organizationId!
  const { inventarioIds, categoriaId, activo, destacado } = parsed.data

  // Validar categoria pertenece al tenant
  if (categoriaId) {
    const { data: cat } = await supabaseAdmin
      .from("catalogo_categorias")
      .select("id")
      .eq("id", categoriaId)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 400 })
  }

  // Cargar items de inventario (validando pertenencia al tenant)
  const { data: inv, error: invErr } = await supabaseAdmin
    .from("inventario")
    .select("id, nombre, descripcion, precio_venta")
    .in("id", inventarioIds)
    .eq("organization_id", orgId)

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!inv || inv.length === 0) {
    return NextResponse.json({ error: "No se encontraron items de inventario" }, { status: 400 })
  }

  // Saltar los que ya tienen catalogo item linkeado
  const { data: yaCatalogados } = await supabaseAdmin
    .from("catalogo_items")
    .select("inventario_id")
    .eq("organization_id", orgId)
    .in("inventario_id", inv.map((i) => i.id))

  const yaSet = new Set((yaCatalogados ?? []).map((y) => y.inventario_id).filter(Boolean) as string[])
  const aImportar = inv.filter((i) => !yaSet.has(i.id))

  if (aImportar.length === 0) {
    return NextResponse.json({
      ok: true,
      creados: 0,
      saltados: inv.length,
      mensaje: "Todos los items seleccionados ya están en el catálogo",
    })
  }

  // Calcular orden inicial: max actual + 1, incrementando por item
  const { data: maxOrden } = await supabaseAdmin
    .from("catalogo_items")
    .select("orden")
    .eq("organization_id", orgId)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle()

  let nextOrden = (maxOrden?.orden ?? -1) + 1

  const rows = aImportar.map((it) => ({
    organization_id: orgId,
    tipo: "PRODUCTO" as const,
    nombre: it.nombre,
    descripcion: it.descripcion ?? null,
    categoria_id: categoriaId ?? null,
    inventario_id: it.id,
    precio: it.precio_venta != null ? Number(it.precio_venta) : null,
    precio_hasta: null,
    imagen_url: null,
    imagenes: [],
    etiquetas: [],
    stock: null, // null = source of truth en inventario via inventario_id
    destacado: destacado ?? false,
    activo: activo ?? false, // por defecto inactivo para revisión
    orden: nextOrden++,
  }))

  const { data: creados, error: insertErr } = await supabaseAdmin
    .from("catalogo_items")
    .insert(rows)
    .select("id")

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  revalidateTag("catalogo", "max")
  return NextResponse.json({
    ok: true,
    creados: creados?.length ?? 0,
    saltados: inv.length - aImportar.length,
  })
}
