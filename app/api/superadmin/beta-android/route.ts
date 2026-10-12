import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"
import { BETA_ESTADOS, BETA_MAX_IDS_POR_LOTE } from "@/lib/android-beta"

// Tope de la lista: es la cola de un cupo de testers que se carga a mano en
// Play Console, no un listado que crezca sin limite.
const LIMITE = 1000

const filtroSchema = z.enum([...BETA_ESTADOS, "TODOS"])

const updateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(BETA_MAX_IDS_POR_LOTE),
  estado: z.enum(BETA_ESTADOS),
})

interface FilaBeta {
  id: string
  email: string
  estado: string
  created_at: string
  agregado_at: string | null
  users: { nombre: string; email: string } | null
  organizations: { nombre: string } | null
}

export async function GET(request: Request) {
  const { error } = await requireSuperadmin()
  if (error) return error

  const crudo = new URL(request.url).searchParams.get("estado") || "TODOS"
  const filtro = filtroSchema.safeParse(crudo)
  if (!filtro.success) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
  }

  let query = supabaseAdmin
    .from("android_beta_testers")
    .select("id, email, estado, created_at, agregado_at, users(nombre, email), organizations(nombre)")
    .order("created_at", { ascending: false })
    .limit(LIMITE)

  if (filtro.data !== "TODOS") {
    query = query.eq("estado", filtro.data)
  }

  const { data, error: dbError } = await query
  if (dbError) {
    console.error("[superadmin/beta-android] GET", dbError)
    return NextResponse.json({ error: "Error al obtener los inscriptos" }, { status: 500 })
  }

  const testers = ((data ?? []) as unknown as FilaBeta[]).map((f) => ({
    id: f.id,
    email: f.email,
    estado: f.estado,
    created_at: f.created_at,
    agregado_at: f.agregado_at,
    usuario: f.users ? { nombre: f.users.nombre, email: f.users.email } : null,
    taller: f.organizations?.nombre ?? null,
  }))

  return NextResponse.json({ testers })
}

export async function PATCH(request: Request) {
  const { error, email } = await requireSuperadmin()
  if (error) return error

  const parsed = await safeParseBody(request, updateSchema)
  if ("error" in parsed) return parsed.error
  const { ids, estado } = parsed.data

  const { data, error: dbError } = await supabaseAdmin
    .from("android_beta_testers")
    .update({
      estado,
      // Solo AGREGADO deja fecha: es cuando se cargo a la lista de Play.
      agregado_at: estado === "AGREGADO" ? new Date().toISOString() : null,
    })
    .in("id", ids)
    .select("id")

  if (dbError) {
    console.error("[superadmin/beta-android] PATCH", dbError)
    return NextResponse.json({ error: "Error al actualizar los inscriptos" }, { status: 500 })
  }

  createSuperadminAuditLogger(email, request).betaAndroidUpdate(ids, estado).catch(() => {})

  return NextResponse.json({ actualizados: data?.length ?? 0 })
}
