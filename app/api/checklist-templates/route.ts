import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const templateSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  activo: z.boolean().optional().default(true),
})

// GET - Obtener todos los templates de la organización
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: templates, error: dbError } = await supabaseAdmin
      .from("checklist_templates")
      .select(`*, checklist_template_items (*)`)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(templates)
  } catch (error) {
    console.error("Error fetching checklist templates:", error)
    return NextResponse.json(
      { error: "Error al obtener templates" },
      { status: 500 }
    )
  }
}

// POST - Crear un nuevo template
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = templateSchema.parse(body)

    // Verificar si ya existe un template con ese nombre
    const { data: existing } = await supabaseAdmin
      .from("checklist_templates")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("nombre", data.nombre)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: "Ya existe un template con ese nombre" },
        { status: 400 }
      )
    }

    const { data: template, error: createError } = await supabaseAdmin
      .from("checklist_templates")
      .insert({
        nombre: data.nombre,
        activo: data.activo,
        organization_id: organizationId!,
      })
      .select()
      .single()

    if (createError) throw createError

    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating checklist template:", error)
    return NextResponse.json(
      { error: "Error al crear template" },
      { status: 500 }
    )
  }
}
