import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadOrderPhoto, deleteFile, base64ToBuffer } from "@/lib/storage"
import { formatFoto } from "@/lib/db-utils"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
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
    const { error } = autenticado
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
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id: ordenId } = await params

    // The order must exist, belong to the organization and be within the caller's scope
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    // Verificar límite de storage antes de subir
    const storageLimitError = await enforcePlanLimit(organizationId!, "storage")
    if (storageLimitError) return storageLimitError

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

    // Actualizar uso de storage. La RPC raisea si se excede el limite del
    // plan (race condition que el pre-check TS no atrapa). En ese caso,
    // rollbackear: borrar el archivo subido y el row recien insertado.
    const { error: storageRpcError } = await updateStorageUsage(organizationId!, buffer.length)
    if (storageRpcError) {
      if (isPlanLimitError(storageRpcError)) {
        await deleteFile("FOTOS_ORDENES", path)
        await supabaseAdmin.from("fotos_orden").delete().eq("id", foto.id)
        return planLimitErrorResponse(storageRpcError)
      }
      console.error("Error updating storage usage:", storageRpcError)
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
