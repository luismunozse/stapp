import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"
import { fetchAllRows, fetchAllRowsIn } from "@/lib/fetch-all-rows"

const broadcastSchema = z.object({
  title: z.string().min(1, "Titulo requerido").max(200),
  message: z.string().min(1, "Mensaje requerido").max(5000),
  target: z.enum(["all", "specific"]).default("all"),
  organizationIds: z.array(z.string().min(1)).optional(),
  roles: z.array(z.enum(["ADMIN", "TECNICO", "VENDEDOR"])).optional(),
  actionUrl: z
    .string()
    .max(2000)
    .refine(
      (v) => v.startsWith("/") || /^https?:\/\//.test(v),
      "Debe ser una ruta relativa (/ruta) o una URL absoluta (https://...)"
    )
    .nullable()
    .optional(),
})

export async function GET() {
  const { error } = await requireSuperadmin()
  if (error) return error

  try {
    const { data, error: dbError } = await supabaseAdmin
      .from("broadcasts")
      .select("id, title, body, action_url, target, filters, total_users, sent_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50)

    if (dbError) {
      console.error("Error fetching broadcasts:", dbError)
      return NextResponse.json({ error: "Error al obtener broadcasts" }, { status: 500 })
    }

    return NextResponse.json({
      broadcasts: (data || []).map((b) => ({
        title: b.title,
        body: b.body,
        created_at: b.created_at,
        count: b.total_users,
      })),
    })
  } catch (err) {
    console.error("Error fetching broadcasts:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { error, email } = await requireSuperadmin()
  if (error) return error

  try {
    const parsed = await safeParseBody(request, broadcastSchema)
    if ("error" in parsed) return parsed.error

    const { title, message, target, organizationIds, roles, actionUrl } = parsed.data

    // Idempotencia por contenido + ventana: rechaza un broadcast idéntico
    // (mismo título/cuerpo/target) enviado hace menos de 5 minutos. Cubre el
    // doble-click y los retries de red / backoff lento sin necesidad de una
    // idempotency key.
    const sixtySecAgo = new Date(Date.now() - 300_000).toISOString()
    const { data: recentDup } = await supabaseAdmin
      .from("broadcasts")
      .select("id")
      .eq("title", title)
      .eq("body", message)
      .eq("target", target)
      .gte("created_at", sixtySecAgo)
      .limit(1)
    if (recentDup && recentDup.length > 0) {
      return NextResponse.json(
        { error: "Ya enviaste un broadcast idéntico hace instantes. Esperá un momento antes de reintentar." },
        { status: 409 }
      )
    }

    // Solo usuarios de orgs activas (excluye la org interna del panel para que
    // los usuarios internos no reciban los broadcasts de clientes).
    // Todo paginado: PostgREST corta cada lectura en 1000 filas sin error, así
    // que antes el broadcast llegaba como mucho a 1000 usuarios (y a los de
    // las primeras 1000 orgs). fetchAllRows lanza si una página falla (500).
    const activeOrgs = await fetchAllRows<{ id: string }>("organizations", "id", (q) =>
      q.eq("activo", true).neq("slug", "superadmin").is("deleted_at", null)
    )
    const activeOrgIds = activeOrgs.map((o) => o.id)

    if (activeOrgIds.length === 0) {
      return NextResponse.json({ error: "No hay organizaciones activas" }, { status: 400 })
    }

    let targetOrgIds = activeOrgIds
    if (target === "specific") {
      // Intersectar con activas (sin orgs elegidas, ninguna: nunca "todas")
      const activas = new Set(activeOrgIds)
      targetOrgIds = [...new Set(organizationIds ?? [])].filter((id) => activas.has(id))
      if (targetOrgIds.length === 0) {
        return NextResponse.json({ error: "Ninguna organizacion seleccionada esta activa" }, { status: 400 })
      }
    }

    const users = await fetchAllRowsIn<{ id: string; organization_id: string; rol: string }>(
      "users",
      "id, organization_id, rol",
      "organization_id",
      targetOrgIds,
      (q) => (roles && roles.length > 0 ? q.in("rol", roles) : q)
    )

    if (!users || users.length === 0) {
      return NextResponse.json({ error: "No hay usuarios que coincidan con los filtros" }, { status: 400 })
    }

    // Crear registro de broadcast
    const { data: broadcast, error: broadcastError } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        title,
        body: message,
        action_url: actionUrl || null,
        target,
        filters: roles && roles.length > 0 ? { roles, organizationIds: target === "specific" ? organizationIds : undefined } : null,
        total_users: users.length,
        sent_by: email || null,
      })
      .select("id")
      .single()

    if (broadcastError) {
      console.error("Error creating broadcast record:", broadcastError)
      return NextResponse.json({ error: "Error al crear registro de broadcast" }, { status: 500 })
    }

    // Crear notificaciones en lotes de 500
    const notifications = users.map((user) => ({
      organization_id: user.organization_id,
      user_id: user.id,
      title,
      body: message,
      type: "BROADCAST",
      icon: "megaphone",
      action_url: actionUrl || null,
      orden_id: null,
      cliente_id: null,
      broadcast_id: broadcast.id,
    }))

    const BATCH_SIZE = 500
    let totalInserted = 0

    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      const batch = notifications.slice(i, i + BATCH_SIZE)
      const { error: insertError } = await supabaseAdmin
        .from("user_notifications")
        .insert(batch)

      if (insertError) {
        console.error(`Error inserting batch ${i}:`, insertError)
        console.error(`Error inserting notification batch ${i}:`, insertError)
        return NextResponse.json(
          { error: "Error al insertar notificaciones", inserted: totalInserted },
          { status: 500 }
        )
      }
      totalInserted += batch.length
    }

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email || null, request)
    auditLogger.broadcast(title, totalInserted, target).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Notificacion enviada a ${totalInserted} usuarios`,
      totalUsers: totalInserted,
    })
  } catch (err) {
    console.error("Error sending broadcast:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
