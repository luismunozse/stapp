import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

export async function GET(request: Request) {
  try {
    const { error } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")
    const search = searchParams.get("search") || ""
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")

    let query = supabaseAdmin
      .from("leads")
      .select(
        `
        *,
        organization:organizations(*),
        assigned_user:users(*)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    // Filtrar por estado
    if (estado && estado !== "TODOS") {
      query = query.eq("estado", estado)
    }

    // Búsqueda
    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,email.ilike.%${search}%,telefono.ilike.%${search}%,empresa.ilike.%${search}%`
      )
    }

    const { data: leads, error: dbError, count } = await query

    if (dbError) throw dbError

    return NextResponse.json({ leads, total: count })
  } catch (error) {
    console.error("Error fetching leads:", error)
    return NextResponse.json({ error: "Error al obtener leads" }, { status: 500 })
  }
}

const updateLeadSchema = z.object({
  estado: z.enum(["NUEVO", "CONTACTADO", "CALIFICADO", "CONVERTIDO", "DESCARTADO"]).optional(),
  notas: z.string().optional(),
  assigned_to: z.string().optional().nullable(),
  organization_id: z.string().optional().nullable(),
})

export async function PATCH(request: Request) {
  try {
    const { error } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get("id")

    if (!leadId) {
      return NextResponse.json({ error: "ID de lead requerido" }, { status: 400 })
    }

    const body = await request.json()
    const data = updateLeadSchema.parse(body)

    const { data: lead, error: updateError } = await supabaseAdmin
      .from("leads")
      .update(data)
      .eq("id", leadId)
      .select()
      .single()

    if (updateError) throw updateError

    return NextResponse.json(lead)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error updating lead:", error)
    return NextResponse.json({ error: "Error al actualizar lead" }, { status: 500 })
  }
}
