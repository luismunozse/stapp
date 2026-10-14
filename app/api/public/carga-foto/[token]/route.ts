import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import { hashBorradorToken, canAcceptFoto } from "@/lib/foto-borrador-token"
import { sniffImageMime, reencodeFoto, MAX_FOTO_BYTES } from "@/lib/foto-borrador-image"

const BUCKET = "foto-borrador"

type Ctx = { params: Promise<{ token: string }> }

/**
 * Respuesta única para TODA falla. Token inexistente, vencido, revocado o con
 * el tope alcanzado responden exactamente igual, así que desde afuera no se
 * puede sondear qué borradores existen.
 */
const rechazo = () => NextResponse.json({ error: "No se pudo subir la foto" }, { status: 400 })

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params

  const porToken = await rateLimit(`cf:${token}`, 20, 5 * 60 * 1000)
  if (!porToken.success) return rechazo()

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida"
  const porIp = await rateLimit(`cf-ip:${ip}`, 60, 5 * 60 * 1000)
  if (!porIp.success) return rechazo()

  // El crudo solo se usa para derivar el hash; nunca va a una query.
  const tokenHash = hashBorradorToken(token)

  const { data: borrador } = await supabaseAdmin
    .from("foto_borrador")
    .select("id, organization_id, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .single()

  if (!borrador) return rechazo()

  const { count } = await supabaseAdmin
    .from("foto_borrador_item")
    .select("id", { count: "exact", head: true })
    .eq("borrador_id", borrador.id)

  const puede = canAcceptFoto(
    { revokedAt: borrador.revoked_at, expiresAt: borrador.expires_at },
    count ?? 0,
    new Date(),
  )
  if (!puede.ok) return rechazo()

  let body: { data?: unknown }
  try {
    body = await req.json()
  } catch {
    return rechazo()
  }
  if (!body?.data || typeof body.data !== "string") return rechazo()

  const buffer = Buffer.from(body.data, "base64")
  if (buffer.length === 0 || buffer.length > MAX_FOTO_BYTES) return rechazo()

  // El tipo sale de los bytes, no de ningún header que mande el cliente.
  if (!sniffImageMime(buffer)) return rechazo()

  let normalizada: { buffer: Buffer; mime: "image/jpeg" }
  try {
    normalizada = await reencodeFoto(buffer)
  } catch {
    return rechazo()
  }

  const path = `${borrador.organization_id}/${borrador.id}/${uuidv4()}.jpg`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, normalizada.buffer, { contentType: normalizada.mime, upsert: false })

  if (upErr) return rechazo()

  const { error: dbErr } = await supabaseAdmin.from("foto_borrador_item").insert({
    borrador_id: borrador.id,
    storage_path: path,
    mime: normalizada.mime,
    size: normalizada.buffer.length,
  })

  if (dbErr) {
    // Si no quedó la fila, el objeto no debe quedar huérfano ocupando storage.
    await supabaseAdmin.storage
      .from(BUCKET)
      .remove([path])
      .catch(() => {})
    return rechazo()
  }

  return NextResponse.json({ ok: true })
}
