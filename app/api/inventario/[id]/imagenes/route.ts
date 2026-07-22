import { NextResponse } from "next/server"
import { requireAuth, requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadInventarioImage } from "@/lib/storage"

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_IMAGES_PER_ITEM = 10

function formatImg(row: any) {
  return {
    id: row.id,
    url: row.url,
    path: row.path,
    orden: row.orden,
    esPrincipal: row.es_principal,
    alt: row.alt,
    createdAt: row.created_at,
  }
}

// GET /api/inventario/[id]/imagenes — galería
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data, error: dbErr } = await supabaseAdmin
      .from("inventario_imagenes")
      .select("*")
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .order("orden", { ascending: true })
      .order("created_at", { ascending: true })

    if (dbErr) throw dbErr

    return NextResponse.json({ data: (data || []).map(formatImg) })
  } catch (err) {
    console.error("Error fetching imagenes:", err)
    return NextResponse.json({ error: "Error al obtener imágenes" }, { status: 500 })
  }
}

// POST /api/inventario/[id]/imagenes — sube nueva imagen a la galería
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params

    // Validar pertenencia
    const { data: item } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (!item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    // Límite por item
    const { count } = await supabaseAdmin
      .from("inventario_imagenes")
      .select("id", { count: "exact", head: true })
      .eq("inventario_id", id)
    if ((count ?? 0) >= MAX_IMAGES_PER_ITEM) {
      return NextResponse.json(
        { error: `Máximo ${MAX_IMAGES_PER_ITEM} imágenes por item` },
        { status: 400 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo no permitido. JPG, PNG o WebP" },
        { status: 400 }
      )
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Excede 5MB" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url, path } = await uploadInventarioImage(organizationId!, id, buffer, file.type)

    // Si es la primera imagen → es_principal = true
    const esPrincipal = (count ?? 0) === 0
    const orden = (count ?? 0)

    const { data: row, error: insErr } = await supabaseAdmin
      .from("inventario_imagenes")
      .insert({
        inventario_id: id,
        url,
        path,
        orden,
        es_principal: esPrincipal,
        organization_id: organizationId!,
      })
      .select("*")
      .single()

    if (insErr) throw insErr

    return NextResponse.json(formatImg(row), { status: 201 })
  } catch (err) {
    console.error("Error uploading imagen:", err)
    return NextResponse.json({ error: "Error al subir imagen" }, { status: 500 })
  }
}
