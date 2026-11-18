import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { deleteFile } from "@/lib/storage"
import { guardarFotoOrden } from "@/lib/fotos/guardar-foto-orden"
import { formatFoto } from "@/lib/db-utils"
import { firmarCampo } from "@/lib/storage-privado"
import { updateStorageUsage } from "@/lib/subscriptions"
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
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id: ordenId } = await params

    // The order must belong to the organization and be within the caller's scope
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "ver", { select: "id" })
    if ("error" in cargada) return cargada.error

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

    // El bucket es privado: cada foto sale con una URL firmada que vence.
    const firmadas = await firmarCampo("FOTOS_ORDENES", fotos ?? [], "url", {
      campoPath: "storage_path",
      prefijo: organizationId!,
    })

    return NextResponse.json(firmadas.map(formatFoto))
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
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id: ordenId } = await params

    // The order must exist, belong to the organization and be within the caller's scope
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    const body = await request.json()
    const data = fotoSchema.parse(body)

    const guardada = await guardarFotoOrden({
      organizationId: organizationId!,
      ordenId,
      data: data.data,
      mime: data.mime,
      tipo: data.tipo,
      descripcion: data.descripcion,
    })
    if ("error" in guardada) return guardada.error
    const { foto } = guardada

    const [fotoFirmada] = await firmarCampo("FOTOS_ORDENES", [foto], "url", {
      campoPath: "storage_path",
      prefijo: organizationId!,
    })

    return NextResponse.json(formatFoto(fotoFirmada), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
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
    const autenticado = await requireAuth()
    const { error } = autenticado
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
      .select("id, orden_id, storage_path")
      .eq("id", fotoId)
      .single()

    if (fetchError || !foto) {
      return NextResponse.json(
        { error: "Foto no encontrada" },
        { status: 404 }
      )
    }

    // A photo is worked through its order: one whose order belongs to another
    // organization or is outside the caller's scope is a photo that is not there.
    const cargada = await cargarOrdenEnAlcance(foto.orden_id, actorDeSesion(autenticado), "reparar", {
      select: "id",
      noEncontrada: "Foto no encontrada",
    })
    if ("error" in cargada) return cargada.error

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
