import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadOrderPhoto, deleteFile, base64ToBuffer } from "@/lib/storage"
import { formatFoto } from "@/lib/db-utils"
import { z } from "zod"

const fotoSchema = z.object({
  data: z.string().min(1, "Imagen requerida"),
  mime: z.string().min(1, "Tipo de imagen requerido"),
  descripcion: z.string().optional(),
  tipo: z.enum(["INGRESO", "DIAGNOSTICO", "COMPONENTE", "REPARACION", "ENTREGA"]).default("REPARACION"),
})

// GET - Obtener fotos de una orden
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    // Verificar que la orden pertenece a la organización
    const { data: ordenCheck } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (!ordenCheck) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const tipo = searchParams.get("tipo")

    let query = supabaseAdmin
      .from("fotos_orden")
      .select("id, url, storage_path, mime, size, descripcion, tipo, created_at")
      .eq("orden_id", ordenId)
      .order("created_at", { ascending: false })

    if (tipo) {
      query = query.eq("tipo", tipo)
    }

    const { data: fotos, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(fotos?.map(formatFoto))
  } catch (error) {
    console.error("Error fetching fotos:", error)
    return NextResponse.json(
      { error: "Error al obtener fotos" },
      { status: 500 }
    )
  }
}

// POST - Subir una nueva foto (ahora usa Storage)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    // Verificar que la orden existe y pertenece a la organización
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, organization_id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const data = fotoSchema.parse(body)

    // Validar tamaño de imagen (máx 5MB en base64)
    const base64Size = data.data.length * 0.75
    const maxSize = 5 * 1024 * 1024
    if (base64Size > maxSize) {
      return NextResponse.json(
        { error: "La imagen excede el tamaño máximo de 5MB" },
        { status: 400 }
      )
    }

    // Subir a Supabase Storage
    const buffer = base64ToBuffer(data.data)
    const { url, path } = await uploadOrderPhoto(
      organizationId!,
      ordenId,
      buffer,
      data.mime
    )

    // Guardar referencia en la base de datos
    const { data: foto, error: dbError } = await supabaseAdmin
      .from("fotos_orden")
      .insert({
        orden_id: ordenId,
        url,
        storage_path: path,
        mime: data.mime,
        size: buffer.length,
        descripcion: data.descripcion || null,
        tipo: data.tipo,
      })
      .select("id, url, storage_path, mime, size, descripcion, tipo, created_at")
      .single()

    if (dbError) {
      // Si falla el insert, eliminar el archivo subido
      await deleteFile("FOTOS_ORDENES", path)
      throw dbError
    }

    return NextResponse.json(formatFoto(foto), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating foto:", error)
    return NextResponse.json(
      { error: "Error al subir foto" },
      { status: 500 }
    )
  }
}

// DELETE - Eliminar una foto
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const fotoId = searchParams.get("fotoId")

    if (!fotoId) {
      return NextResponse.json(
        { error: "ID de foto requerido" },
        { status: 400 }
      )
    }

    // Obtener la foto para verificar y obtener el path
    const { data: foto, error: fetchError } = await supabaseAdmin
      .from("fotos_orden")
      .select("id, storage_path, ordenes_servicio!inner(organization_id)")
      .eq("id", fotoId)
      .single()

    if (fetchError || !foto) {
      return NextResponse.json(
        { error: "Foto no encontrada" },
        { status: 404 }
      )
    }

    // Verificar que pertenece a la organización
    const ordenOrgId = (foto.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // Eliminar de Storage
    if (foto.storage_path) {
      await deleteFile("FOTOS_ORDENES", foto.storage_path)
    }

    // Eliminar de la base de datos
    const { error: deleteError } = await supabaseAdmin
      .from("fotos_orden")
      .delete()
      .eq("id", fotoId)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: "Foto eliminada" })
  } catch (error) {
    console.error("Error deleting foto:", error)
    return NextResponse.json(
      { error: "Error al eliminar foto" },
      { status: 500 }
    )
  }
}
