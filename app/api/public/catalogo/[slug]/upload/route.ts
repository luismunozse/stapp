import { NextResponse } from "next/server"
import { supabaseAdmin, STORAGE_BUCKETS, getPublicUrl } from "@/lib/supabase"

const ALLOWED = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 4 * 1024 * 1024
const MAX_FILES_HINT = 3 // sugerencia frontend; el backend acepta 1 por request

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
    return NextResponse.json({ error: "Catálogo no disponible" }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Form data inválida" }, { status: 400 })
  }

  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No se envió archivo" }, { status: 400 })

  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Solo JPG, PNG o WEBP" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Archivo supera 4MB" }, { status: 400 })
  }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")
  const path = `${config.organization_id}/cotizacion-publica/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.CATALOGO)
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error("Error subiendo adjunto catálogo público:", uploadError)
    return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 })
  }

  const url = getPublicUrl(STORAGE_BUCKETS.CATALOGO, path)
  return NextResponse.json({ url, maxFiles: MAX_FILES_HINT })
}
