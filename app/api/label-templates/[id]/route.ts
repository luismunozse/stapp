import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const formatoEnum = z.enum(["ZPL", "EPL", "PDF"])

const updateSchema = z.object({
  nombre: z.string().min(1).max(80).optional(),
  formato: formatoEnum.optional(),
  ancho_mm: z.number().positive().max(300).optional(),
  alto_mm: z.number().positive().max(300).optional(),
  dpi: z.union([z.literal(152), z.literal(203), z.literal(300)]).optional(),
  template: z.string().min(1).optional(),
  es_default: z.boolean().optional(),
  notas: z.string().max(500).optional().nullable(),
})

// GET /api/label-templates/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id } = await params

    const { data, error: dbError } = await supabaseAdmin
      .from("label_templates")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (dbError || !data) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }
    return NextResponse.json(data)
  } catch (err) {
    console.error("[label-templates/:id] GET error:", err)
    return NextResponse.json(
      { error: "Error al obtener template" },
      { status: 500 },
    )
  }
}

// PATCH /api/label-templates/[id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id } = await params

    const body = await request.json()
    const data = updateSchema.parse(body)

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("label_templates")
      .select("id, formato, es_default")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // El formato efectivo post-update — relevante si el caller cambia formato
    // y es_default al mismo tiempo.
    const effectiveFormato = data.formato ?? existing.formato

    // Si es_default=true → demote otros del mismo formato antes de actualizar.
    if (data.es_default === true) {
      await supabaseAdmin
        .from("label_templates")
        .update({ es_default: false })
        .eq("organization_id", organizationId!)
        .eq("formato", effectiveFormato)
        .neq("id", id)
        .is("deleted_at", null)
    }

    const updatePayload: Record<string, unknown> = {}
    if (data.nombre !== undefined) updatePayload.nombre = data.nombre
    if (data.formato !== undefined) updatePayload.formato = data.formato
    if (data.ancho_mm !== undefined) updatePayload.ancho_mm = data.ancho_mm
    if (data.alto_mm !== undefined) updatePayload.alto_mm = data.alto_mm
    if (data.dpi !== undefined) updatePayload.dpi = data.dpi
    if (data.template !== undefined) updatePayload.template = data.template
    if (data.es_default !== undefined) updatePayload.es_default = data.es_default
    if (data.notas !== undefined) updatePayload.notas = data.notas

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("label_templates")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single()

    if (updateError) throw updateError
    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("[label-templates/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Error al actualizar template" },
      { status: 500 },
    )
  }
}

// DELETE /api/label-templates/[id] (soft-delete)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id } = await params

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("label_templates")
      .select("id, formato, es_default")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // No permitir borrar el último default activo del formato (queda la org sin
    // default y la UI tendría que adivinar). Si quiere borrarlo, primero marca
    // otro como default.
    if (existing.es_default) {
      const { count } = await supabaseAdmin
        .from("label_templates")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!)
        .eq("formato", existing.formato)
        .is("deleted_at", null)
        .neq("id", id)

      if (!count || count === 0) {
        return NextResponse.json(
          {
            error:
              "No podés eliminar el único template del formato. Creá otro antes o marcá otro como default primero.",
          },
          { status: 400 },
        )
      }
    }

    const { error: delError } = await supabaseAdmin
      .from("label_templates")
      .update({ deleted_at: new Date().toISOString(), es_default: false })
      .eq("id", id)

    if (delError) throw delError
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[label-templates/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Error al eliminar template" },
      { status: 500 },
    )
  }
}
