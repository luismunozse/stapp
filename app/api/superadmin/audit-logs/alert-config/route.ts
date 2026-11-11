import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("audit_alert_config")
      .select("*")
      .eq("id", "default")
      .single()

    if (dbError) throw dbError

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error fetching alert config:", error)
    return NextResponse.json(
      { error: "Error al obtener configuración de alertas" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const body = await request.json()

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: email,
    }

    if (typeof body.user_activity_threshold === "number" && body.user_activity_threshold > 0) {
      updateData.user_activity_threshold = body.user_activity_threshold
    }
    if (typeof body.user_activity_window_hours === "number" && body.user_activity_window_hours > 0) {
      updateData.user_activity_window_hours = body.user_activity_window_hours
    }
    if (typeof body.failed_login_threshold === "number" && body.failed_login_threshold > 0) {
      updateData.failed_login_threshold = body.failed_login_threshold
    }
    if (typeof body.failed_login_window_hours === "number" && body.failed_login_window_hours > 0) {
      updateData.failed_login_window_hours = body.failed_login_window_hours
    }
    if (typeof body.retention_days === "number" && body.retention_days >= 30) {
      updateData.retention_days = body.retention_days
    }

    // Fail-closed: esta config fija la retención de la propia auditoría, así que
    // un cambio sin rastro podría usarse para borrar el historial.
    const cambios = Object.fromEntries(
      Object.entries(updateData).filter(([k]) => k !== "updated_at" && k !== "updated_by")
    )
    const intento = await createSuperadminAuditLogger(email, request).exigir({
      action: "UPDATE",
      entity: "audit_alert_config",
      entityId: "default",
      description: "Configuración de alertas/retención de auditoría actualizada",
      metadata: { changes: cambios },
    })
    if (!intento.ok) return intento.respuesta

    const { data, error: dbError } = await supabaseAdmin
      .from("audit_alert_config")
      .update(updateData)
      .eq("id", "default")
      .select()
      .single()

    if (dbError) {
      await intento.completar({ error: dbError.message }, "fallido")
      throw dbError
    }

    await intento.completar()

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating alert config:", error)
    return NextResponse.json(
      { error: "Error al actualizar configuración de alertas" },
      { status: 500 }
    )
  }
}
