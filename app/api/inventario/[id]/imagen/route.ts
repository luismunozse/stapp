import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadInventarioImage, deleteInventarioImage } from "@/lib/storage"

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

// POST — Subir o reemplazar la imagen de un item de inventario
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  try {
    const { id } = await params

    // Verificar ownership y obtener imagen previa (para borrarla)
    const { data: item, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("id, imagen_path")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Use JPG, PNG o WebP" },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "El archivo excede el límite de 5MB" },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url, path } = await uploadInventarioImage(
      organizationId!,
      id,
      buffer,
      file.type
    )

    // Actualizar el row. Primero guardamos la nueva URL/path y después borramos
    // la imagen vieja (fail-safe: si el delete falla, la nueva ya quedó persistida).
    const { error: updateError } = await supabaseAdmin
      .from("inventario")
      .update({
        imagen_url: url,
        imagen_path: path,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (updateError) throw updateError

    if (item.imagen_path && item.imagen_path !== path) {
      await deleteInventarioImage(item.imagen_path)
    }

    return NextResponse.json({ imagenUrl: url, imagenPath: path })
  } catch (err) {
    console.error("Error uploading inventario image:", err)
    return NextResponse.json(
      { error: "Error al subir imagen" },
      { status: 500 }
    )
  }
}

// DELETE — Quitar la imagen del item
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  try {
    const { id } = await params

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("id, imagen_path")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    if (item.imagen_path) {
      await deleteInventarioImage(item.imagen_path)
    }

    const { error: updateError } = await supabaseAdmin
      .from("inventario")
      .update({
        imagen_url: null,
        imagen_path: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (updateError) throw updateError

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting inventario image:", err)
    return NextResponse.json(
      { error: "Error al eliminar imagen" },
      { status: 500 }
    )
  }
}
