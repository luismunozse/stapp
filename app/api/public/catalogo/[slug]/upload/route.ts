import { NextResponse } from "next/server"
import { supabaseAdmin, STORAGE_BUCKETS, getPublicUrl } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import { detectImageMime } from "@/lib/image-magic-bytes"
import crypto from "node:crypto"

const ALLOWED = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 4 * 1024 * 1024
const MAX_FILES_HINT = 3

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: "Slug inválido" }, { status: 400 })
  }

  // Rate limit más estricto que el del middleware (20/min/IP genérico).
  // 6 uploads/min/IP/slug es suficiente para que un cliente cargue 3 fotos
  // por item × 2 items, pero corta abuso de storage exhaustion.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await rateLimit(`catupload:${ip}:${slug}`, 6, 60_000)
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiadas subidas. Esperá un minuto." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.reset),
        },
      }
    )
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

  const buffer = Buffer.from(await file.arrayBuffer())

  // Validar magic bytes: el header Content-Type del cliente es spoofeable.
  // Si los primeros bytes no matchean PNG/JPEG/WEBP rechazamos.
  const realMime = detectImageMime(buffer)
  if (!realMime) {
    return NextResponse.json({ error: "Archivo no es una imagen válida" }, { status: 400 })
  }
  if (realMime !== file.type) {
    return NextResponse.json({ error: "Tipo de archivo no coincide con el contenido" }, { status: 400 })
  }

  // Path randomizado: no exponemos organization_id como segmento del path
  // (era discoverable en cada URL pública). Bucket sigue siendo público
  // hoy — TODO: migrar a bucket privado con signed URLs.
  const ext = realMime === "image/jpeg" ? "jpg" : realMime === "image/png" ? "png" : "webp"
  const orgHash = crypto
    .createHash("sha256")
    .update(`${config.organization_id}:${process.env.NEXTAUTH_SECRET || "stapp"}`)
    .digest("hex")
    .slice(0, 16)
  const rand = crypto.randomBytes(16).toString("hex")
  const path = `${orgHash}/cotizacion-publica/${Date.now()}-${rand}.${ext}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.CATALOGO)
    .upload(path, buffer, { contentType: realMime, upsert: false })

  if (uploadError) {
    console.error("Error subiendo adjunto catálogo público:", uploadError)
    return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 })
  }

  const url = getPublicUrl(STORAGE_BUCKETS.CATALOGO, path)
  return NextResponse.json({ url, maxFiles: MAX_FILES_HINT })
}
