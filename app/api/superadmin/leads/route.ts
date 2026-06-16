import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"
import { escapeOrIlikeTerm } from "@/lib/pg-search"

const updateLeadSchema = z.object({
  id: z.string().min(1, "ID requerido"),
  estado: z.enum(["NUEVO", "CONTACTADO", "CALIFICADO", "CONVERTIDO", "DESCARTADO"]).optional(),
  nombre: z.string().max(200).optional(),
  email: z.string().email().nullable().optional(),
  telefono: z.string().max(50).nullable().optional(),
  empresa: z.string().max(200).nullable().optional(),
  notas: z.string().max(5000).nullable().optional(),
  plan_interes: z.string().max(50).nullable().optional(),
  interes: z.string().max(500).nullable().optional(),
})

export async function GET(request: NextRequest) {
  const { error } = await requireSuperadmin()
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")
    const origen = searchParams.get("origen")
    const urgencia = searchParams.get("urgencia")
    const minScoreRaw = searchParams.get("minScore")
    const sort = searchParams.get("sort") || "score_desc"
    const search = searchParams.get("search")
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")

    let query = supabaseAdmin
      .from("leads")
      .select("*, chatbot_conversaciones(id, session_id, created_at, lead_capturado)", { count: "exact" })
      .range(offset, offset + limit - 1)

    if (sort === "score_desc") {
      query = query.order("score", { ascending: false }).order("created_at", { ascending: false })
    } else if (sort === "score_asc") {
      query = query.order("score", { ascending: true }).order("created_at", { ascending: false })
    } else if (sort === "created_asc") {
      query = query.order("created_at", { ascending: true })
    } else {
      query = query.order("created_at", { ascending: false })
    }

    if (estado && estado !== "TODOS") {
      query = query.eq("estado", estado)
    }

    if (origen && origen !== "TODOS") {
      query = query.eq("origen", origen)
    }

    if (urgencia && urgencia !== "TODOS") {
      query = query.eq("urgencia", urgencia)
    }

    if (minScoreRaw) {
      const minScore = parseInt(minScoreRaw)
      if (Number.isFinite(minScore) && minScore > 0) {
        query = query.gte("score", minScore)
      }
    }

    if (search) {
      const s = escapeOrIlikeTerm(search)
      if (s) {
        query = query.or(
          `nombre.ilike.%${s}%,email.ilike.%${s}%,telefono.ilike.%${s}%,empresa.ilike.%${s}%`
        )
      }
    }

    const { data, error: dbError, count } = await query

    if (dbError) throw dbError

    return NextResponse.json({ leads: data || [], total: count || 0 })
  } catch (err) {
    console.error("Error fetching leads:", err)
    return NextResponse.json({ error: "Error al obtener leads" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const { error, email } = await requireSuperadmin()
  if (error) return error

  try {
    const parsed = await safeParseBody(request, updateLeadSchema)
    if ("error" in parsed) return parsed.error

    const { id, ...updates } = parsed.data

    const { data, error: dbError } = await supabaseAdmin
      .from("leads")
      .update({ ...updates, ultima_interaccion: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger.leadUpdate(id, updates).catch(() => {})

    return NextResponse.json(data)
  } catch (err) {
    console.error("Error updating lead:", err)
    return NextResponse.json({ error: "Error al actualizar lead" }, { status: 500 })
  }
}
