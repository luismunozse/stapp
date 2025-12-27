import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const itemSchema = z.object({
  label: z.string().min(1, "La etiqueta es requerida"),
  tipo: z.enum(["BOOLEAN", "TEXT", "SELECT"]).default("BOOLEAN"),
  categoria: z.enum(["CONDICION_FISICA", "ACCESORIOS", "FUNCIONAL", "OTRO"]).default("OTRO"),
  opciones: z.string().optional(), // JSON array para tipo SELECT
  orden: z.number().int().optional(),
  requerido: z.boolean().optional().default(false),
})

const updateItemSchema = itemSchema.partial()

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    orden: z.number().int(),
  })),
})

// GET - Obtener items de un template
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id: templateId } = await params

    // Verificar que el template existe y pertenece a la organización
    const { data: template, error: templateError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("id", templateId)
      .eq("organization_id", organizationId!)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("checklist_template_items")
      .select("*")
      .eq("template_id", templateId)
      .order("orden", { ascending: true })

    if (itemsError) throw itemsError

    return NextResponse.json(items)
  } catch (error) {
    console.error("Error fetching template items:", error)
    return NextResponse.json(
      { error: "Error al obtener items" },
      { status: 500 }
    )
  }
}

// POST - Agregar un nuevo item al template
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id: templateId } = await params
    const body = await request.json()
    const data = itemSchema.parse(body)

    // Verificar que el template existe y pertenece a la organización
    const { data: template, error: templateError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("id", templateId)
      .eq("organization_id", organizationId!)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // Si no se especifica orden, poner al final
    let orden = data.orden
    if (orden === undefined) {
      const { data: lastItem } = await supabaseAdmin
        .from("checklist_template_items")
        .select("orden")
        .eq("template_id", templateId)
        .order("orden", { ascending: false })
        .limit(1)
        .single()
      orden = lastItem ? lastItem.orden + 1 : 0
    }

    const { data: item, error: createError } = await supabaseAdmin
      .from("checklist_template_items")
      .insert({
        template_id: templateId,
        label: data.label,
        tipo: data.tipo,
        categoria: data.categoria,
        opciones: data.opciones,
        orden,
        requerido: data.requerido,
      })
      .select()
      .single()

    if (createError) throw createError

    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating template item:", error)
    return NextResponse.json(
      { error: "Error al crear item" },
      { status: 500 }
    )
  }
}

// PUT - Actualizar item o reordenar items
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id: templateId } = await params
    const body = await request.json()

    // Verificar que el template existe y pertenece a la organización
    const { data: template, error: templateError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("id", templateId)
      .eq("organization_id", organizationId!)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // Detectar si es un reorder o una actualización individual
    if (body.items && Array.isArray(body.items)) {
      // Reordenar items
      const data = reorderSchema.parse(body)

      for (const { id, orden } of data.items) {
        await supabaseAdmin
          .from("checklist_template_items")
          .update({ orden })
          .eq("id", id)
      }

      const { data: items } = await supabaseAdmin
        .from("checklist_template_items")
        .select("*")
        .eq("template_id", templateId)
        .order("orden", { ascending: true })

      return NextResponse.json(items)
    } else if (body.itemId) {
      // Actualizar un item específico
      const { itemId, ...updateData } = body
      const data = updateItemSchema.parse(updateData)

      const { data: item, error: updateError } = await supabaseAdmin
        .from("checklist_template_items")
        .update(data)
        .eq("id", itemId)
        .select()
        .single()

      if (updateError) throw updateError

      return NextResponse.json(item)
    }

    return NextResponse.json(
      { error: "Formato de request inválido" },
      { status: 400 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating template items:", error)
    return NextResponse.json(
      { error: "Error al actualizar items" },
      { status: 500 }
    )
  }
}

// DELETE - Eliminar un item (via query param)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id: templateId } = await params
    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get("itemId")

    if (!itemId) {
      return NextResponse.json({ error: "ID del item es requerido" }, { status: 400 })
    }

    // Verificar que el template existe y pertenece a la organización
    const { data: template, error: templateError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("id", templateId)
      .eq("organization_id", organizationId!)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    // Verificar que el item pertenece al template
    const { data: item, error: itemError } = await supabaseAdmin
      .from("checklist_template_items")
      .select("id")
      .eq("id", itemId)
      .eq("template_id", templateId)
      .single()

    if (itemError || !item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    await supabaseAdmin.from("checklist_template_items").delete().eq("id", itemId)

    return NextResponse.json({ message: "Item eliminado" })
  } catch (error) {
    console.error("Error deleting template item:", error)
    return NextResponse.json(
      { error: "Error al eliminar item" },
      { status: 500 }
    )
  }
}
