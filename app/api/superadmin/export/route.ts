import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

/**
 * GET: Exportar datos del sistema en CSV.
 * Query params:
 * - type: "organizations" | "users" | "subscriptions"
 * - status: filtro opcional (activo/inactivo, etc.)
 */
export async function GET(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")
    const status = searchParams.get("status")

    if (!type || !["organizations", "users", "subscriptions"].includes(type)) {
      return NextResponse.json(
        { error: "Tipo de export inválido. Usar: organizations, users, subscriptions" },
        { status: 400 }
      )
    }

    let csvRows: string[] = []
    let filename = ""

    if (type === "organizations") {
      let query = supabaseAdmin
        .from("organizations")
        .select(`
          id, nombre, slug, email, telefono, activo, pais, moneda, zona_horaria, created_at,
          subscriptions (status, trial_end, plan_id)
        `)
        .order("created_at", { ascending: false })
        .limit(10000)

      if (status === "activo") query = query.eq("activo", true)
      if (status === "inactivo") query = query.eq("activo", false)

      const { data, error: dbError } = await query
      if (dbError) throw dbError

      csvRows = [
        ["ID", "Nombre", "Slug", "Email", "Teléfono", "Activo", "País", "Moneda", "Zona Horaria", "Estado Suscripción", "Fin Trial", "Creado"].join(","),
      ]

      for (const org of data || []) {
        const sub = Array.isArray(org.subscriptions) ? org.subscriptions[0] : org.subscriptions
        csvRows.push(
          [
            org.id,
            `"${(org.nombre || "").replace(/"/g, '""')}"`,
            org.slug || "-",
            org.email || "-",
            org.telefono || "-",
            org.activo ? "Si" : "No",
            org.pais || "-",
            org.moneda || "-",
            org.zona_horaria || "-",
            (sub as any)?.status || "-",
            (sub as any)?.trial_end || "-",
            org.created_at,
          ].join(",")
        )
      }
      filename = `organizaciones-${new Date().toISOString().split("T")[0]}.csv`
    }

    if (type === "users") {
      const { data, error: dbError } = await supabaseAdmin
        .from("users")
        .select(`
          id, nombre, email, rol, email_verified, totp_enabled, created_at,
          organization_id,
          organizations (nombre, slug)
        `)
        .order("created_at", { ascending: false })
        .limit(10000)

      if (dbError) throw dbError

      csvRows = [
        ["ID", "Nombre", "Email", "Rol", "Email Verificado", "2FA Activo", "Organización", "Slug", "Creado"].join(","),
      ]

      for (const user of data || []) {
        const org = Array.isArray(user.organizations) ? user.organizations[0] : user.organizations
        csvRows.push(
          [
            user.id,
            `"${(user.nombre || "").replace(/"/g, '""')}"`,
            user.email,
            user.rol,
            user.email_verified ? "Si" : "No",
            user.totp_enabled ? "Si" : "No",
            `"${((org as any)?.nombre || "-").replace(/"/g, '""')}"`,
            (org as any)?.slug || "-",
            user.created_at,
          ].join(",")
        )
      }
      filename = `usuarios-${new Date().toISOString().split("T")[0]}.csv`
    }

    if (type === "subscriptions") {
      const { data, error: dbError } = await supabaseAdmin
        .from("subscriptions")
        .select(`
          id, organization_id, plan_id, status, trial_end, current_period_start, current_period_end,
          cancel_at_period_end, created_at,
          organizations (nombre, slug),
          plans (name)
        `)
        .order("created_at", { ascending: false })
        .limit(10000)

      if (dbError) throw dbError

      csvRows = [
        ["ID", "Organización", "Slug", "Plan", "Estado", "Fin Trial", "Inicio Periodo", "Fin Periodo", "Cancelar al Final", "Creado"].join(","),
      ]

      for (const sub of data || []) {
        const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
        const plan = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
        csvRows.push(
          [
            sub.id,
            `"${((org as any)?.nombre || "-").replace(/"/g, '""')}"`,
            (org as any)?.slug || "-",
            (plan as any)?.name || "-",
            sub.status,
            sub.trial_end || "-",
            sub.current_period_start || "-",
            sub.current_period_end || "-",
            sub.cancel_at_period_end ? "Si" : "No",
            sub.created_at,
          ].join(",")
        )
      }
      filename = `suscripciones-${new Date().toISOString().split("T")[0]}.csv`
    }

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "EXPORT",
        entity: "system",
        description: `Export de ${type} (${csvRows.length - 1} registros)`,
        metadata: { type, status, count: csvRows.length - 1 },
      })
      .catch(() => {})

    const csv = csvRows.join("\n")

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error("Error exporting data:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
