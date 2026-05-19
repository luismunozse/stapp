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

    // Multi-imagen: la imagen vieja principal se reemplaza. Estrategia:
    // 1) Buscar fila principal previa (si existe) + borrar fila + path bucket.
    // 2) Insertar nueva como principal → trigger sync_inventario_imagen_principal
    //    actualiza inventario.imagen_url/path automáticamente.
    const { data: prevPrincipal } = await supabaseAdmin
      .from("inventario_imagenes")
      .select("id, path")
      .eq("inventario_id", id)
      .eq("es_principal", true)
      .maybeSingle()

    if (prevPrincipal) {
      await supabaseAdmin.from("inventario_imagenes").delete().eq("id", prevPrincipal.id)
      if (prevPrincipal.path) {
        await deleteInventarioImage(prevPrincipal.path)
      }
    } else if (item.imagen_path) {
      // Legacy fallback: item con imagen_url pre-migración 173 sin fila espejo
      await deleteInventarioImage(item.imagen_path)
    }

    const { error: insErr } = await supabaseAdmin
      .from("inventario_imagenes")
      .insert({
        inventario_id: id,
        url,
        path,
        orden: 0,
        es_principal: true,
        organization_id: organizationId!,
      })

    if (insErr) throw insErr

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

    // Borrar toda la galería + paths del bucket. Trigger sincroniza el cache
    // de inventario.imagen_url/path a NULL al borrar la última fila.
    const { data: imgs } = await supabaseAdmin
      .from("inventario_imagenes")
      .select("path")
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)

    const { error: delErr } = await supabaseAdmin
      .from("inventario_imagenes")
      .delete()
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
    if (delErr) throw delErr

    for (const i of imgs || []) {
      if (i.path) await deleteInventarioImage(i.path)
    }

    // Legacy fallback si no había filas en la galería
    if ((imgs?.length ?? 0) === 0 && item.imagen_path) {
      await deleteInventarioImage(item.imagen_path)
      await supabaseAdmin
        .from("inventario")
        .update({ imagen_url: null, imagen_path: null })
        .eq("id", id)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting inventario image:", err)
    return NextResponse.json(
      { error: "Error al eliminar imagen" },
      { status: 500 }
    )
  }
}
