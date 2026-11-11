import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

const bulkToggleSchema = z.object({
  ids: z.array(z.string().min(1, "ID inválido")).min(1, "Debe seleccionar al menos una organización"),
  activo: z.boolean(),
  motivo: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, bulkToggleSchema)
    if ("error" in parsed) return parsed.error

    const { ids, activo, motivo } = parsed.data

    // Al suspender en lote exigimos motivo, igual que el toggle individual.
    const suspensionReason = typeof motivo === "string" ? motivo.trim() : ""
    if (!activo && !suspensionReason) {
      return NextResponse.json(
        { error: "Se requiere un motivo para suspender organizaciones" },
        { status: 400 }
      )
    }

    // Guard: filtrar la org del panel admin para no desactivarla
    const { data: protectedOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .in("id", ids)
      .eq("slug", "superadmin")
    const protectedIds = (protectedOrgs || []).map((o) => o.id)
    const targetIds = ids.filter((id) => !protectedIds.includes(id))

    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "Ninguna organización válida (la del panel admin está protegida)" },
        { status: 400 }
      )
    }

    // Auditoría fail-closed ANTES del cambio masivo.
    const intento = await createSuperadminAuditLogger(email, request).exigir({
      action: "BULK_ACTION",
      entity: "organizations",
      description: activo
        ? `Activación masiva de ${targetIds.length} organización(es)`
        : `Suspensión masiva de ${targetIds.length} organización(es) — motivo: ${suspensionReason}`,
      metadata: { orgIds: targetIds, newStatus: activo, suspension_reason: activo ? null : suspensionReason },
    })
    if (!intento.ok) return intento.respuesta

    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({
        activo,
        suspension_reason: activo ? null : suspensionReason,
        suspended_at: activo ? null : new Date().toISOString(),
        suspended_by: activo ? null : email,
      })
      .in("id", targetIds)
      .select("id")

    if (dbError) {
      await intento.completar({ error: dbError.message }, "fallido")
      throw dbError
    }

    const count = data?.length ?? 0

    await intento.completar({ count })

    return NextResponse.json({ success: true, count })
  } catch (error) {
    console.error("Error bulk toggling organizations:", error)
    return NextResponse.json(
      { error: "Error al cambiar estado de organizaciones en lote" },
      { status: 500 }
    )
  }
}
