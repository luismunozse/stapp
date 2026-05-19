import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { EVENT_TYPES, generateWebhookSecret } from "@/lib/webhooks/dispatcher"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(100),
  // Solo HTTPS. http en producción expone el HMAC al MITM (firma viaja en header).
  url: z.string().url().refine((u) => u.startsWith("https://"), "URL debe ser HTTPS"),
  events: z.array(z.enum(EVENT_TYPES as unknown as [string, ...string[]])).min(1, "Al menos un evento"),
  headers: z.record(z.string()).nullable().optional(),
  activo: z.boolean().optional(),
})

// Helper: no devolvemos el secret en list por defecto.
function formatWebhook(row: any, opts?: { includeSecret?: boolean }) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events ?? [],
    activo: row.activo,
    headers: row.headers ?? null,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    consecutiveFailures: row.consecutive_failures ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(opts?.includeSecret ? { secret: row.secret } : {}),
  }
}

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data, error: dbErr } = await supabaseAdmin
      .from("webhooks")
      .select("*")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (dbErr) throw dbErr

    return NextResponse.json({ data: (data || []).map((r) => formatWebhook(r)) })
  } catch (err) {
    console.error("Error fetching webhooks:", err)
    return NextResponse.json({ error: "Error al obtener webhooks" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = createSchema.parse(body)

    const secret = generateWebhookSecret()

    const { data: row, error: insErr } = await supabaseAdmin
      .from("webhooks")
      .insert({
        organization_id: organizationId!,
        name: data.name,
        url: data.url,
        secret,
        events: data.events,
        headers: data.headers ?? null,
        activo: data.activo ?? true,
      })
      .select("*")
      .single()

    if (insErr) throw insErr

    // Secret one-time: solo expuesto en la respuesta de creación / rotación.
    return NextResponse.json(formatWebhook(row, { includeSecret: true }), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating webhook:", err)
    return NextResponse.json({ error: "Error al crear webhook" }, { status: 500 })
  }
}
