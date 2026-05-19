import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const formatoEnum = z.enum(["ZPL", "EPL", "PDF"])

const createSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido").max(80),
  formato: formatoEnum,
  ancho_mm: z.number().positive().max(300).default(50),
  alto_mm: z.number().positive().max(300).default(30),
  dpi: z.union([z.literal(152), z.literal(203), z.literal(300)]).default(203),
  template: z.string().min(1, "El template no puede estar vacío"),
  es_default: z.boolean().optional().default(false),
  notas: z.string().max(500).optional().nullable(),
})

// GET /api/label-templates?formato=ZPL
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const formato = searchParams.get("formato")

    let query = supabaseAdmin
      .from("label_templates")
      .select("*")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("es_default", { ascending: false })
      .order("created_at", { ascending: false })

    if (formato) {
      const parsed = formatoEnum.safeParse(formato)
      if (!parsed.success) {
        return NextResponse.json({ error: "formato inválido" }, { status: 400 })
      }
      query = query.eq("formato", parsed.data)
    }

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    return NextResponse.json(data || [])
  } catch (err) {
    console.error("[label-templates] GET error:", err)
    return NextResponse.json(
      { error: "Error al obtener templates" },
      { status: 500 },
    )
  }
}

// POST /api/label-templates
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = createSchema.parse(body)

    // Si es_default=true → demote otros del mismo formato (índice único partial
    // lo impediría de lo contrario).
    if (data.es_default) {
      await supabaseAdmin
        .from("label_templates")
        .update({ es_default: false })
        .eq("organization_id", organizationId!)
        .eq("formato", data.formato)
        .is("deleted_at", null)
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from("label_templates")
      .insert({
        organization_id: organizationId!,
        nombre: data.nombre,
        formato: data.formato,
        ancho_mm: data.ancho_mm,
        alto_mm: data.alto_mm,
        dpi: data.dpi,
        template: data.template,
        es_default: data.es_default,
        notas: data.notas ?? null,
      })
      .select()
      .single()

    if (createError) throw createError
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("[label-templates] POST error:", err)
    return NextResponse.json(
      { error: "Error al crear template" },
      { status: 500 },
    )
  }
}
