import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadAvatar, deleteAvatar } from "@/lib/storage"

const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

// GET - Obtener avatar del usuario actual
export async function GET() {
  const { error, userId, organizationId } = await requireAuth()
  if (error) return error

  const { data } = await supabaseAdmin
    .from("users")
    .select("avatar_url, nombre")
    .eq("id", userId!)
    .eq("organization_id", organizationId!)
    .single()

  return NextResponse.json({
    avatar_url: data?.avatar_url || null,
    nombre: data?.nombre || "",
  })
}

// POST - Subir avatar
export async function POST(request: Request) {
  const { error, userId, organizationId } = await requireAuth()
  if (error) return error

  try {
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
        { error: "El archivo excede el límite de 2MB" },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url } = await uploadAvatar(organizationId!, userId!, buffer, file.type)

    // Guardar URL en la base de datos
    await supabaseAdmin
      .from("users")
      .update({ avatar_url: url })
      .eq("id", userId!)

    return NextResponse.json({ avatar_url: url })
  } catch (err) {
    console.error("Error uploading avatar:", err)
    return NextResponse.json({ error: "Error al subir avatar" }, { status: 500 })
  }
}

// DELETE - Eliminar avatar
export async function DELETE() {
  const { error, userId, organizationId } = await requireAuth()
  if (error) return error

  try {
    await deleteAvatar(organizationId!, userId!)

    await supabaseAdmin
      .from("users")
      .update({ avatar_url: null })
      .eq("id", userId!)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting avatar:", err)
    return NextResponse.json({ error: "Error al eliminar avatar" }, { status: 500 })
  }
}
