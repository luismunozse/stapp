import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin, STORAGE_BUCKETS, getPublicUrl } from "@/lib/supabase"

const ALLOWED = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No se envió archivo" }, { status: 400 })

    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: "Solo JPG, PNG o WEBP" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Archivo supera 4MB" }, { status: 400 })
    }

    const ext = file.name.split(".").pop() || "jpg"
    const path = `${organizationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.CATALOGO)
      .upload(path, buffer, { contentType: file.type, upsert: false })

    if (uploadError) {
      console.error("Error subiendo imagen catálogo:", uploadError)
      return NextResponse.json({ error: "Error al subir imagen" }, { status: 500 })
    }

    const url = getPublicUrl(STORAGE_BUCKETS.CATALOGO, path)
    return NextResponse.json({ url, path })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Error al subir imagen" }, { status: 500 })
  }
}
