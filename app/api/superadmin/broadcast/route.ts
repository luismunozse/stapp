import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

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
      return NextResponse.json({ error: dbError.message }, { status: 500 })
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
    const body = await request.json()
    const { title, message, target, organizationIds, roles, actionUrl } = body

    if (!title || !message) {
      return NextResponse.json(
        { error: "Titulo y mensaje son requeridos" },
        { status: 400 }
      )
    }

    // Construir query de usuarios destino
    let query = supabaseAdmin.from("users").select("id, organization_id, rol")

    // Filtrar por organizaciones específicas
    if (target === "specific" && organizationIds?.length > 0) {
      query = query.in("organization_id", organizationIds)
    }

    // Filtrar por roles
    if (roles?.length > 0) {
      query = query.in("rol", roles)
    }

    // Solo usuarios de orgs activas
    const { data: activeOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("activo", true)

    const activeOrgIds = activeOrgs?.map((o) => o.id) || []

    if (activeOrgIds.length === 0) {
      return NextResponse.json({ error: "No hay organizaciones activas" }, { status: 400 })
    }

    // Si target es "all", solo filtrar por orgs activas
    if (target !== "specific") {
      query = query.in("organization_id", activeOrgIds)
    } else {
      // Intersectar con activas
      const filteredIds = organizationIds.filter((id: string) => activeOrgIds.includes(id))
      if (filteredIds.length === 0) {
        return NextResponse.json({ error: "Ninguna organizacion seleccionada esta activa" }, { status: 400 })
      }
      query = query.in("organization_id", filteredIds)
    }

    const { data: users, error: usersError } = await query

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

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
        filters: roles?.length > 0 ? { roles, organizationIds: target === "specific" ? organizationIds : undefined } : null,
        total_users: users.length,
        sent_by: email || null,
      })
      .select("id")
      .single()

    if (broadcastError) {
      console.error("Error creating broadcast record:", broadcastError)
      return NextResponse.json({ error: broadcastError.message }, { status: 500 })
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
        return NextResponse.json(
          { error: `Error al insertar lote: ${insertError.message}`, inserted: totalInserted },
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
