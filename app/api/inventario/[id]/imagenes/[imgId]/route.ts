import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { deleteInventarioImage } from "@/lib/storage"
import { z } from "zod"

const patchSchema = z.object({
  esPrincipal: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
  alt: z.string().max(200).nullable().optional(),
})

// PATCH — set principal, reorder, alt text
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; imgId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id, imgId } = await params
    const body = await request.json()
    const data = patchSchema.parse(body)

    const updateData: Record<string, any> = {}
    if (data.esPrincipal !== undefined) updateData.es_principal = data.esPrincipal
    if (data.orden !== undefined) updateData.orden = data.orden
    if (data.alt !== undefined) updateData.alt = data.alt

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
    }

    const { data: row, error: updErr } = await supabaseAdmin
      .from("inventario_imagenes")
      .update(updateData)
      .eq("id", imgId)
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (updErr || !row) {
      return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 })
    }

    return NextResponse.json({
      id: row.id,
      url: row.url,
      orden: row.orden,
      esPrincipal: row.es_principal,
      alt: row.alt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error patching imagen:", err)
    return NextResponse.json({ error: "Error al actualizar imagen" }, { status: 500 })
  }
}

// DELETE — borra del bucket + fila
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; imgId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id, imgId } = await params

    const { data: img } = await supabaseAdmin
      .from("inventario_imagenes")
      .select("id, path")
      .eq("id", imgId)
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!img) {
      return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 })
    }

    const { error: delErr } = await supabaseAdmin
      .from("inventario_imagenes")
      .delete()
      .eq("id", imgId)

    if (delErr) throw delErr

    if (img.path) {
      await deleteInventarioImage(img.path)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting imagen:", err)
    return NextResponse.json({ error: "Error al eliminar imagen" }, { status: 500 })
  }
}
