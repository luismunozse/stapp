import { NextResponse } from "next/server"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedorAdjunto } from "@/lib/db-utils"

const BUCKET = "proveedor-adjuntos"
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 días

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
])

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
}

const uploadSchema = z.object({
  nombre: z.string().min(1, "Nombre requerido"),
  descripcion: z.string().optional(),
  mime: z.string().min(1),
  // Archivo en base64 (sin prefijo data:)
  file: z.string().min(1, "Archivo requerido"),
})

async function ensureProveedor(id: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("proveedores")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single()
  return !!data
}

async function withSignedUrl(adj: any) {
  if (!adj?.file_path) return formatProveedorAdjunto(adj)
  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(adj.file_path, SIGNED_URL_TTL)
  return { ...formatProveedorAdjunto(adj), fileUrl: signed?.signedUrl || adj.file_url }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Mismo eje que el resto del namespace: ver el comentario en
    // app/api/proveedores/route.ts.
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    const { data, error: dbErr } = await supabaseAdmin
      .from("proveedor_adjuntos")
      .select("*")
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (dbErr) throw dbErr

    const items = await Promise.all((data || []).map(withSignedUrl))
    return NextResponse.json(items)
  } catch (err) {
    console.error("Error fetching adjuntos:", err)
    return NextResponse.json({ error: "Error al obtener adjuntos" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    if (!(await ensureProveedor(id, organizationId!))) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    const body = await request.json()
    const data = uploadSchema.parse(body)

    if (!ALLOWED_MIME.has(data.mime)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 })
    }

    const buffer = Buffer.from(data.file, "base64")
    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Archivo supera 10MB" }, { status: 400 })
    }

    const ext = MIME_EXT[data.mime] || "bin"
    const path = `${organizationId}/${id}/${uuidv4()}.${ext}`

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: data.mime, upsert: false })
    if (upErr) {
      console.error("Storage upload error:", upErr)
      return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 })
    }

    // Guardar registro. file_url se sirve mediante signed URL en GET, pero
    // dejamos el path como referencia y un placeholder.
    const { data: created, error: dbErr } = await supabaseAdmin
      .from("proveedor_adjuntos")
      .insert({
        proveedor_id: id,
        organization_id: organizationId!,
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        file_url: path,
        file_path: path,
        mime: data.mime,
        size_bytes: buffer.length,
        uploaded_by: userId ?? null,
      })
      .select()
      .single()

    if (dbErr) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => {})
      throw dbErr
    }

    return NextResponse.json(await withSignedUrl(created), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error uploading adjunto:", err)
    return NextResponse.json({ error: "Error al subir adjunto" }, { status: 500 })
  }
}
