import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { verifyReauth } from "@/lib/account-deletion/reauth"
import { cancelOrganizationSubscriptions } from "@/lib/account-deletion/cancel-subscriptions"
import { notifyAdminsOrgDeleted } from "@/lib/account-deletion/emails"
import { DELETION_REASON, graceEndsAt } from "@/lib/account-deletion/state"

const bodySchema = z.object({
  confirmSlug: z.string().min(1).max(100),
  password: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  totpCode: z.string().max(32).optional(),
})

const ALREADY_PENDING = "El taller ya está en proceso de eliminación"
const GENERIC_FAILURE = "No pudimos procesar la baja del taller"

// POST /api/account/delete-organization: un ADMIN pide eliminar el taller.
// Desactiva el acceso y cancela el cobro YA; el borrado definitivo lo hace el
// cron a los 30 días (hasta entonces soporte puede revertirlo).
export async function POST(request: Request) {
  const { error, userId, organizationId, session } = await requireAdmin()
  if (error) return error

  // El middleware ya bloquea escrituras en impersonación; esto es defensa en profundidad.
  // Los superadmin no tienen un taller propio que dar de baja desde acá.
  if (session!.user.isImpersonating || session!.user.isSuperadmin) {
    return NextResponse.json({ error: "Acción no permitida en esta sesión" }, { status: 403 })
  }

  const parsed = await safeParseBody(request, bodySchema)
  if ("error" in parsed) return parsed.error
  const { confirmSlug, ...reauthInput } = parsed.data

  // El taller sale SIEMPRE de la sesión, nunca del body.
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, slug, nombre, deleted_at, deletion_requested_at")
    .eq("id", organizationId!)
    .single()
  if (orgError || !org) return NextResponse.json({ error: "Taller no encontrado" }, { status: 404 })
  if (org.slug === "superadmin") {
    return NextResponse.json({ error: "No se puede eliminar la organización del panel admin" }, { status: 403 })
  }
  if (org.deleted_at || org.deletion_requested_at) {
    return NextResponse.json({ error: ALREADY_PENDING }, { status: 409 })
  }
  if (confirmSlug.trim().toLowerCase() !== String(org.slug).toLowerCase()) {
    return NextResponse.json({ error: "El subdominio no coincide" }, { status: 400 })
  }

  const reauth = await verifyReauth(userId!, reauthInput)
  if (!reauth.ok) {
    // Cuenta bloqueada por intentos fallidos: 429, el resto de fallos conserva su status.
    const status = reauth.code === "ACCOUNT_LOCKED" ? 429 : reauth.status
    return NextResponse.json({ error: reauth.error, code: reauth.code }, { status })
  }

  // 1) Cancelar el cobro. Si falla cualquier proveedor: 502 y NADA cambia en
  //    nuestra DB, para no dejar un taller desactivado que siga cobrándose. Los
  //    que ya cancelaron quedan cancelados y el reintento es idempotente.
  const cancel = await cancelOrganizationSubscriptions(org.id)
  if (!cancel.ok) {
    return NextResponse.json(
      { error: "No pudimos cancelar tu suscripción, reintentá o escribí a soporte", providers: cancel.failed },
      { status: 502 }
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // 2) canceled_at es contabilidad: si falla se loguea y se sigue archivando,
  //    porque los proveedores ya cancelaron y dejar el taller activo sería peor.
  const { error: subsError } = await supabaseAdmin
    .from("subscriptions")
    .update({ canceled_at: nowIso })
    .eq("organization_id", org.id)
  if (subsError) {
    console.error("[account/delete-organization] subscriptions canceled_at:", subsError)
  }

  // 3) Archivar: el middleware corta el acceso en <=30 s. Los .is(..., null)
  //    evitan pisar a otra request concurrente (TOCTOU).
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("organizations")
    .update({
      deleted_at: nowIso,
      deleted_by: session!.user.email ?? null,
      archived_reason: DELETION_REASON,
      deletion_requested_at: nowIso,
    })
    .eq("id", org.id)
    .is("deleted_at", null)
    .is("deletion_requested_at", null)
    .select("id")
  if (updateError) {
    console.error("[account/delete-organization] organizations update:", updateError)
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 500 })
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    // 0 filas: o lo archivó otra request (409) o pasó algo inesperado (500).
    const { data: actual, error: rereadError } = await supabaseAdmin
      .from("organizations")
      .select("deleted_at, deletion_requested_at")
      .eq("id", org.id)
      .single()
    if (rereadError) {
      console.error("[account/delete-organization] re-lectura tras UPDATE sin filas:", rereadError)
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 500 })
    }
    if (actual?.deleted_at || actual?.deletion_requested_at) {
      return NextResponse.json({ error: ALREADY_PENDING }, { status: 409 })
    }
    console.error("[account/delete-organization] el UPDATE de organizations no afectó filas:", org.id)
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 500 })
  }

  const borradoDefinitivo = graceEndsAt(now)

  // Auditoría: best-effort, la baja ya está hecha y no se deshace.
  try {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: org.id,
      user_id: userId,
      action: "ARCHIVE",
      entity: "organizations",
      entity_id: org.id,
      changes: { reason: DELETION_REASON, requested_by: session!.user.email ?? null },
    })
    if (auditError) console.error("[account/delete-organization] audit_logs:", auditError)
  } catch (err) {
    console.error("[account/delete-organization] audit_logs:", err)
  }

  await notifyAdminsOrgDeleted({
    organizationId: org.id,
    orgNombre: org.nombre,
    solicitante: session!.user.email ?? "",
    borradoDefinitivo,
  })

  return NextResponse.json({ success: true, deletionDate: borradoDefinitivo.toISOString() })
}
