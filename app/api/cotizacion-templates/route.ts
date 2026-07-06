import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { z } from "zod"

const templateSchema = z.object({
  nombre: z.string().min(1, "Nombre requerido"),
  descripcion: z.string().optional(),
  notas: z.string().optional(),
  terminos: z.string().optional(),
  descuentoGlobalTipo: z.enum(["porcentaje", "fijo"]).optional(),
  descuentoGlobalValor: z.number().min(0).optional(),
  ivaPorcentaje: z.number().min(0).max(100).optional(),
  items: z.array(z.object({
    descripcion: z.string().min(1),
    cantidad: z.number().int().positive(),
    precioUnitario: z.number().min(0),
    unidad: z.string().optional(),
    descuentoTipo: z.enum(["porcentaje", "fijo"]).optional(),
    descuentoValor: z.number().min(0).optional(),
  })).min(1, "Debe tener al menos un item"),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: templates, error: dbError } = await supabaseAdmin
      .from("cotizacion_templates")
      .select(`
        *,
        items_template_cotizacion (*)
      `)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(
      (templates || []).map((t: any) => ({
        id: t.id,
        nombre: t.nombre,
        descripcion: t.descripcion,
        notas: t.notas,
        terminos: t.terminos,
        descuentoGlobalTipo: t.descuento_global_tipo,
        descuentoGlobalValor: t.descuento_global_valor,
        ivaPorcentaje: t.iva_porcentaje,
        createdAt: t.created_at,
        items: (t.items_template_cotizacion || [])
          .sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
          .map((i: any) => ({
            id: i.id,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            precioUnitario: Number(i.precio_unitario),
            unidad: i.unidad,
            descuentoTipo: i.descuento_tipo,
            descuentoValor: Number(i.descuento_valor),
          })),
      }))
    )
  } catch (error) {
    console.error("Error fetching templates:", error)
    return NextResponse.json(
      { error: "Error al obtener plantillas" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    const hasCotizaciones = await hasPlanFeature(organizationId!, "cotizaciones_online")
    if (!hasCotizaciones) {
      return NextResponse.json(
        { error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" },
        { status: 403 }
      )
    }

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden crear plantillas" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = templateSchema.parse(body)

    const { data: template, error: createError } = await supabaseAdmin
      .from("cotizacion_templates")
      .insert({
        organization_id: organizationId,
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        notas: data.notas || null,
        terminos: data.terminos || null,
        descuento_global_tipo: data.descuentoGlobalTipo || "porcentaje",
        descuento_global_valor: data.descuentoGlobalValor || 0,
        iva_porcentaje: data.ivaPorcentaje || 0,
      })
      .select()
      .single()

    if (createError) throw createError

    // Create items
    const { error: itemsError } = await supabaseAdmin
      .from("items_template_cotizacion")
      .insert(
        data.items.map((item, index) => ({
          template_id: template.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precioUnitario,
          unidad: item.unidad || "Unidad",
          descuento_tipo: item.descuentoTipo || "porcentaje",
          descuento_valor: item.descuentoValor || 0,
          orden: index,
        }))
      )

    if (itemsError) {
      await supabaseAdmin.from("cotizacion_templates").delete().eq("id", template.id)
      throw itemsError
    }

    return NextResponse.json({ id: template.id, nombre: template.nombre }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating template:", error)
    return NextResponse.json(
      { error: "Error al crear plantilla" },
      { status: 500 }
    )
  }
}
