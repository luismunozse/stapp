import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin, STORAGE_BUCKETS, getPublicUrl } from "@/lib/supabase"

/**
 * Sube un archivo (imagen o PDF) al bucket comprobantes-gastos
 * y devuelve la URL pública.
 *
 * El frontend después usa esa URL al crear/actualizar el movimiento.
 */
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No se envió archivo" }, { status: 400 })
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Usá JPG, PNG, WEBP o PDF." },
        { status: 400 }
      )
    }

    const maxBytes = 5 * 1024 * 1024
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "El archivo supera el tamaño máximo de 5MB" },
        { status: 400 }
      )
    }

    const ext = file.name.split(".").pop() || "bin"
    const path = `${organizationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.COMPROBANTES_GASTOS)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error("Error subiendo comprobante:", uploadError)
      return NextResponse.json({ error: "Error al subir comprobante" }, { status: 500 })
    }

    const url = getPublicUrl(STORAGE_BUCKETS.COMPROBANTES_GASTOS, path)

    return NextResponse.json({ url, path })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Error al subir comprobante" }, { status: 500 })
  }
}
