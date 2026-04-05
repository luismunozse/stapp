import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

const overrideSchema = z.object({
  organizationId: z.string().min(1, "ID de organización requerido"),
  limite_ordenes: z.number().int().min(0).nullable().optional(),
  limite_tecnicos: z.number().int().min(0).nullable().optional(),
  limite_clientes: z.number().int().min(0).nullable().optional(),
  limite_vendedores: z.number().int().min(0).nullable().optional(),
  limite_storage_mb: z.number().int().min(0).nullable().optional(),
  motivo: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, overrideSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, motivo, ...limits } = parsed.data

    // Verificar que la org existe
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre")
      .eq("id", organizationId)
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }

    // Upsert override
    const { data, error: dbError } = await supabaseAdmin
      .from("organization_limit_overrides")
      .upsert(
        {
          organization_id: organizationId,
          ...limits,
          motivo: motivo || null,
          aplicado_por: email,
        },
        { onConflict: "organization_id" }
      )
      .select()
      .single()

    if (dbError) throw dbError

    // Registrar en historial
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("organization_id", organizationId)
      .single()

    if (sub) {
      await supabaseAdmin.from("subscription_history").insert({
        subscription_id: sub.id,
        organization_id: organizationId,
        action: "LIMIT_OVERRIDE",
        details: { limits, motivo },
        performed_by: email,
      })
    }

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "UPDATE",
        entity: "subscriptions",
        organizationId,
        description: `Límites personalizados aplicados a "${org.nombre}"`,
        metadata: { limits, motivo },
      })
      .catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Límites actualizados para ${org.nombre}`,
      overrides: data,
    })
  } catch (err) {
    console.error("Error setting limit overrides:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get("organizationId")

    if (!organizationId) {
      return NextResponse.json({ error: "organizationId requerido" }, { status: 400 })
    }

    await supabaseAdmin
      .from("organization_limit_overrides")
      .delete()
      .eq("organization_id", organizationId)

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "DELETE",
        entity: "subscriptions",
        organizationId,
        description: "Límites personalizados eliminados",
      })
      .catch(() => {})

    return NextResponse.json({ success: true, message: "Límites restaurados al plan" })
  } catch (err) {
    console.error("Error removing limit overrides:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
