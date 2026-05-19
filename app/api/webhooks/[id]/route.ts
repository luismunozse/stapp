import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { EVENT_TYPES, generateWebhookSecret } from "@/lib/webhooks/dispatcher"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().url().refine((u) => u.startsWith("https://"), "URL debe ser HTTPS").optional(),
  events: z.array(z.enum(EVENT_TYPES as unknown as [string, ...string[]])).min(1).optional(),
  headers: z.record(z.string()).nullable().optional(),
  activo: z.boolean().optional(),
})

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { data, error: dbErr } = await supabaseAdmin
      .from("webhooks")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (dbErr || !data) {
      return NextResponse.json({ error: "Webhook no encontrado" }, { status: 404 })
    }

    return NextResponse.json(formatWebhook(data))
  } catch (err) {
    console.error("Error fetching webhook:", err)
    return NextResponse.json({ error: "Error al obtener webhook" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const rotateSecret = url.searchParams.get("rotateSecret") === "true"

    const body = await request.json()
    const data = updateSchema.parse(body)

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("webhooks")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Webhook no encontrado" }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.url !== undefined) updateData.url = data.url
    if (data.events !== undefined) updateData.events = data.events
    if (data.headers !== undefined) updateData.headers = data.headers
    if (data.activo !== undefined) {
      updateData.activo = data.activo
      // Re-activación manual: resetear el contador de fallos consecutivos.
      // Si quedó en 10+ por auto-disable, esto le da otra chance limpia.
      if (data.activo === true) updateData.consecutive_failures = 0
    }
    if (rotateSecret) updateData.secret = generateWebhookSecret()

    const { data: row, error: updErr } = await supabaseAdmin
      .from("webhooks")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (updErr) throw updErr

    // Si rotó el secret, devolverlo (única chance de leerlo).
    return NextResponse.json(formatWebhook(row, { includeSecret: rotateSecret }))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating webhook:", err)
    return NextResponse.json({ error: "Error al actualizar webhook" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Soft-delete: preserva deliveries históricas vinculadas.
    const { data, error: delErr } = await supabaseAdmin
      .from("webhooks")
      .update({ deleted_at: new Date().toISOString(), activo: false })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .select("id")
      .single()

    if (delErr || !data) {
      return NextResponse.json({ error: "Webhook no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting webhook:", err)
    return NextResponse.json({ error: "Error al archivar webhook" }, { status: 500 })
  }
}
