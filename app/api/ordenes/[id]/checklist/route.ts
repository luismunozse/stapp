import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const checklistSchema = z.object({
  templateId: z.string().min(1, "Template requerido"),
  valores: z.record(z.union([z.boolean(), z.string(), z.null()])),
  notas: z.string().optional(),
  firmaCliente: z.string().optional(),
  firmaMime: z.string().optional(),
})

const updateChecklistSchema = z.object({
  valores: z.record(z.union([z.boolean(), z.string(), z.null()])).optional(),
  notas: z.string().optional(),
  firmaCliente: z.string().optional(),
  firmaMime: z.string().optional(),
})

// GET - Obtener el checklist de una orden
export async function GET(
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
      .select("id, tipo_dispositivo_id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Obtener el checklist con el template y sus items
    const { data: checklist } = await supabaseAdmin
      .from("checklists_recepcion")
      .select(`
        *,
        checklist_templates (
          *,
          checklist_template_items (*)
        )
      `)
      .eq("orden_id", ordenId)
      .single()

    if (!checklist) {
      // Si no hay checklist, buscar template por tipo de dispositivo primero
      let template = null

      if (orden.tipo_dispositivo_id) {
        const { data: deviceTemplate } = await supabaseAdmin
          .from("checklist_templates")
          .select(`*, checklist_template_items (*)`)
          .eq("organization_id", organizationId!)
          .eq("activo", true)
          .eq("tipo_dispositivo_id", orden.tipo_dispositivo_id)
          .order("orden", { referencedTable: "checklist_template_items", ascending: true })
          .limit(1)
          .single()

        template = deviceTemplate
      }

      // Fallback: template generico (sin tipo de dispositivo)
      if (!template) {
        const { data: genericTemplate } = await supabaseAdmin
          .from("checklist_templates")
          .select(`*, checklist_template_items (*)`)
          .eq("organization_id", organizationId!)
          .eq("activo", true)
          .is("tipo_dispositivo_id", null)
          .order("orden", { referencedTable: "checklist_template_items", ascending: true })
          .limit(1)
          .single()

        template = genericTemplate
      }

      // Last fallback: any active template
      if (!template) {
        const { data: anyTemplate } = await supabaseAdmin
          .from("checklist_templates")
          .select(`*, checklist_template_items (*)`)
          .eq("organization_id", organizationId!)
          .eq("activo", true)
          .order("orden", { referencedTable: "checklist_template_items", ascending: true })
          .limit(1)
          .single()

        template = anyTemplate
      }

      return NextResponse.json({ checklist: null, template })
    }

    const templateData = checklist.checklist_templates
    return NextResponse.json({
      checklist: {
        id: checklist.id,
        ordenId: checklist.orden_id,
        templateId: checklist.template_id,
        valores: typeof checklist.valores === "string" ? JSON.parse(checklist.valores) : checklist.valores,
        notas: checklist.notas,
        firmaCliente: checklist.firma_cliente,
        firmaMime: checklist.firma_mime,
        createdAt: checklist.created_at,
      },
      template: templateData,
    })
  } catch (error) {
    console.error("Error fetching order checklist:", error)
    return NextResponse.json(
      { error: "Error al obtener checklist" },
      { status: 500 }
    )
  }
}

// POST - Crear checklist para una orden
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const body = await request.json()
    const data = checklistSchema.parse(body)

    // Verificar que la orden existe y pertenece a la organización
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Verificar que no exista ya un checklist
    const { data: existing } = await supabaseAdmin
      .from("checklists_recepcion")
      .select("id")
      .eq("orden_id", ordenId)
      .single()

    if (existing) {
      return NextResponse.json({ error: "Esta orden ya tiene un checklist" }, { status: 400 })
    }

    // Verificar que el template existe y pertenece a la organización
    const { data: template, error: templateError } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("id", data.templateId)
      .eq("organization_id", organizationId!)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 })
    }

    const { data: checklist, error: createError } = await supabaseAdmin
      .from("checklists_recepcion")
      .insert({
        orden_id: ordenId,
        template_id: data.templateId,
        valores: JSON.stringify(data.valores),
        notas: data.notas,
        firma_cliente: data.firmaCliente,
        firma_mime: data.firmaMime,
      })
      .select()
      .single()

    if (createError) throw createError

    return NextResponse.json({
      id: checklist.id,
      ordenId: checklist.orden_id,
      templateId: checklist.template_id,
      valores: typeof checklist.valores === "string" ? JSON.parse(checklist.valores) : checklist.valores,
      notas: checklist.notas,
      firmaCliente: checklist.firma_cliente,
      firmaMime: checklist.firma_mime,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating order checklist:", error)
    return NextResponse.json(
      { error: "Error al crear checklist" },
      { status: 500 }
    )
  }
}

// PUT - Actualizar checklist de una orden
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const body = await request.json()
    const data = updateChecklistSchema.parse(body)

    // Verificar que la orden pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Verificar que existe el checklist
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("checklists_recepcion")
      .select("id")
      .eq("orden_id", ordenId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: "Checklist no encontrado" }, { status: 404 })
    }

    const updateData: any = {}
    if (data.valores) updateData.valores = JSON.stringify(data.valores)
    if (data.notas !== undefined) updateData.notas = data.notas
    if (data.firmaCliente !== undefined) updateData.firma_cliente = data.firmaCliente
    if (data.firmaMime !== undefined) updateData.firma_mime = data.firmaMime

    const { data: checklist, error: updateError } = await supabaseAdmin
      .from("checklists_recepcion")
      .update(updateData)
      .eq("orden_id", ordenId)
      .select()
      .single()

    if (updateError) throw updateError

    return NextResponse.json({
      id: checklist.id,
      ordenId: checklist.orden_id,
      templateId: checklist.template_id,
      valores: typeof checklist.valores === "string" ? JSON.parse(checklist.valores) : checklist.valores,
      notas: checklist.notas,
      firmaCliente: checklist.firma_cliente,
      firmaMime: checklist.firma_mime,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating order checklist:", error)
    return NextResponse.json(
      { error: "Error al actualizar checklist" },
      { status: 500 }
    )
  }
}

// DELETE - Eliminar checklist de una orden
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    // Verificar que la orden pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    await supabaseAdmin
      .from("checklists_recepcion")
      .delete()
      .eq("orden_id", ordenId)

    return NextResponse.json({ message: "Checklist eliminado" })
  } catch (error) {
    console.error("Error deleting order checklist:", error)
    return NextResponse.json(
      { error: "Error al eliminar checklist" },
      { status: 500 }
    )
  }
}
