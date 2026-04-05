import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"

const createChangelogSchema = z.object({
  titulo: z.string().min(1, "Titulo requerido").max(200),
  descripcion: z.string().min(1, "Descripcion requerida").max(5000),
  tipo: z.enum(["MEJORA", "FIX", "NUEVA_FUNCION", "CAMBIO"]).optional().default("MEJORA"),
  importante: z.boolean().optional().default(false),
})

const updateChangelogSchema = z.object({
  id: z.string().uuid("ID inválido"),
  titulo: z.string().min(1).max(200).optional(),
  descripcion: z.string().min(1).max(5000).optional(),
  tipo: z.enum(["MEJORA", "FIX", "NUEVA_FUNCION", "CAMBIO"]).optional(),
  importante: z.boolean().optional(),
  publicado: z.boolean().optional(),
})

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .select("*")
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Error fetching changelog:", error)
    return NextResponse.json({ error: "Error al obtener changelog" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, createChangelogSchema)
    if ("error" in parsed) return parsed.error

    const { titulo, descripcion, tipo, importante } = parsed.data

    const { data, error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .insert({
        titulo,
        descripcion,
        tipo,
        importante,
        publicado: false,
      })
      .select()
      .single()

    if (dbError) throw dbError

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger.changelogCreate(data.id, titulo).catch(() => {})

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error creating changelog:", error)
    return NextResponse.json({ error: "Error al crear entrada" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, updateChangelogSchema)
    if ("error" in parsed) return parsed.error

    const { id, ...updates } = parsed.data

    // Si se publica, setear fecha_publicacion
    const dbUpdates: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() }
    if (updates.publicado === true) {
      dbUpdates.fecha_publicacion = new Date().toISOString()
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger.changelogUpdate(id, data.titulo || id, updates).catch(() => {})

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating changelog:", error)
    return NextResponse.json({ error: "Error al actualizar entrada" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .delete()
      .eq("id", id)

    if (dbError) throw dbError

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger.changelogDelete(id).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting changelog:", error)
    return NextResponse.json({ error: "Error al eliminar entrada" }, { status: 500 })
  }
}
