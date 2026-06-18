import { NextResponse } from "next/server"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { formatProveedor } from "@/lib/db-utils"

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

const uploadSchema = z.object({
  file: z.string().min(1, "Archivo requerido"),
  mime: z.string().min(1),
})

async function getProveedor(id: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("proveedores")
    .select("id, logo_path")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single()
  return data
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    const prov = await getProveedor(id, organizationId!)
    if (!prov) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    const body = await request.json()
    const data = uploadSchema.parse(body)

    const ext = ALLOWED_MIME[data.mime]
    if (!ext) {
      return NextResponse.json({ error: "Formato no permitido (jpg/png/webp)" }, { status: 400 })
    }

    const buffer = Buffer.from(data.file, "base64")
    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "El logo supera 2MB" }, { status: 400 })
    }

    // Borrar logo anterior si existe (puede tener otra extensión).
    if (prov.logo_path) {
      await supabaseAdmin.storage.from(STORAGE_BUCKETS.LOGOS).remove([prov.logo_path]).catch(() => {})
    }

    const path = `proveedores/${organizationId}/${id}-${uuidv4().slice(0, 8)}.${ext}`
    const { error: upErr } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.LOGOS)
      .upload(path, buffer, { contentType: data.mime, upsert: true })

    if (upErr) {
      console.error("Storage upload error:", upErr)
      return NextResponse.json({ error: "Error al subir logo" }, { status: 500 })
    }

    const { data: pub } = supabaseAdmin.storage.from(STORAGE_BUCKETS.LOGOS).getPublicUrl(path)

    const { data: updated, error: dbErr } = await supabaseAdmin
      .from("proveedores")
      .update({ logo_url: pub.publicUrl, logo_path: path })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (dbErr) {
      await supabaseAdmin.storage.from(STORAGE_BUCKETS.LOGOS).remove([path]).catch(() => {})
      throw dbErr
    }

    return NextResponse.json(formatProveedor(updated))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error uploading proveedor logo:", err)
    return NextResponse.json({ error: "Error al subir logo" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    const prov = await getProveedor(id, organizationId!)
    if (!prov) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    if (prov.logo_path) {
      await supabaseAdmin.storage.from(STORAGE_BUCKETS.LOGOS).remove([prov.logo_path]).catch(() => {})
    }

    const { data: updated, error: dbErr } = await supabaseAdmin
      .from("proveedores")
      .update({ logo_url: null, logo_path: null })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (dbErr) throw dbErr
    return NextResponse.json(formatProveedor(updated))
  } catch (err) {
    console.error("Error deleting proveedor logo:", err)
    return NextResponse.json({ error: "Error al eliminar logo" }, { status: 500 })
  }
}
