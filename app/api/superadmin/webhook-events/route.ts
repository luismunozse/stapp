import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"

/**
 * Lista de eventos de webhook recientes para el panel /superadmin/pagos.
 *
 * Permite filtrar por proveedor, status y organización para diagnosticar
 * casos donde un pago real no impactó.
 */
export async function GET(request: Request) {
  const { error } = await requireSuperadmin()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const provider = searchParams.get("provider") || ""
  const status = searchParams.get("status") || ""
  const organizationId = searchParams.get("organizationId") || ""
  const { page, limit, offset } = parsePagination(searchParams)

  let query = supabaseAdmin
    .from("webhook_events")
    .select(
      `
      id,
      provider,
      event_type,
      provider_event_id,
      provider_request_id,
      organization_id,
      subscription_payment_id,
      status,
      http_status,
      signature_valid,
      error_message,
      received_at,
      processed_at,
      duration_ms
    `,
      { count: "exact" }
    )
    .order("received_at", { ascending: false })

  if (provider) query = query.eq("provider", provider.toUpperCase())
  if (status) query = query.eq("status", status.toUpperCase())
  if (organizationId) query = query.eq("organization_id", organizationId)

  query = query.range(offset, offset + limit - 1)

  const { data: events, error: dbError, count } = await query
  if (dbError) {
    return NextResponse.json(
      { error: "Error consultando webhook_events", detail: dbError.message },
      { status: 500 }
    )
  }

  // Resolver nombres de organizaciones en una sola query
  const orgIds = Array.from(
    new Set((events || []).map((e) => e.organization_id).filter(Boolean) as string[])
  )

  let orgsMap: Record<string, { nombre: string; slug: string }> = {}
  if (orgIds.length > 0) {
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .in("id", orgIds)
    orgsMap = (orgs || []).reduce(
      (acc, o) => {
        acc[o.id] = { nombre: o.nombre, slug: o.slug }
        return acc
      },
      {} as Record<string, { nombre: string; slug: string }>
    )
  }

  return NextResponse.json({
    events: (events || []).map((e) => ({
      ...e,
      organization: e.organization_id ? orgsMap[e.organization_id] || null : null,
    })),
    total: count || 0,
    page,
    limit,
  })
}
