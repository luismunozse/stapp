import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const categoriaSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido").max(80),
  tipo: z.enum(["FIJO", "VARIABLE"]).default("VARIABLE"),
  afectaRentabilidad: z.boolean().default(true),
  color: z.string().nullable().optional(),
  icono: z.string().nullable().optional(),
})

// GET - Lista categorías de gasto de la organización
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const incluirInactivas = searchParams.get("incluirInactivas") === "true"

    let query = supabaseAdmin
      .from("categorias_gasto")
      .select("*")
      .eq("organization_id", organizationId!)
      .order("tipo", { ascending: true })
      .order("nombre", { ascending: true })

    if (!incluirInactivas) {
      query = query.eq("activo", true)
    }

    const { data, error: dbError } = await query

    if (dbError) {
      console.error("Error fetching categorias_gasto:", dbError)
      return NextResponse.json({ error: "Error al obtener categorías" }, { status: 500 })
    }

    return NextResponse.json({
      categorias: (data || []).map((c) => ({
        id: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        afectaRentabilidad: c.afecta_rentabilidad,
        color: c.color,
        icono: c.icono,
        activo: c.activo,
      })),
    })
  } catch (err) {
    console.error("Error fetching categorias:", err)
    return NextResponse.json({ error: "Error al obtener categorías" }, { status: 500 })
  }
}

// POST - Crear nueva categoría (solo admin)
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const parsed = categoriaSchema.parse(body)

    const { data, error: insertError } = await supabaseAdmin
      .from("categorias_gasto")
      .insert({
        organization_id: organizationId!,
        nombre: parsed.nombre,
        tipo: parsed.tipo,
        afecta_rentabilidad: parsed.afectaRentabilidad,
        color: parsed.color || null,
        icono: parsed.icono || null,
      })
      .select("*")
      .single()

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe una categoría con ese nombre" },
          { status: 400 }
        )
      }
      console.error("Error creating categoria:", insertError)
      return NextResponse.json({ error: "Error al crear categoría" }, { status: 500 })
    }

    return NextResponse.json({
      categoria: {
        id: data.id,
        nombre: data.nombre,
        tipo: data.tipo,
        afectaRentabilidad: data.afecta_rentabilidad,
        color: data.color,
        icono: data.icono,
        activo: data.activo,
      },
    }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating categoria:", err)
    return NextResponse.json({ error: "Error al crear categoría" }, { status: 500 })
  }
}
