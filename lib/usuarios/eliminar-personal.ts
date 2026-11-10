import { supabaseAdmin } from "@/lib/supabase"
import { BAJA_EMAIL_DOMAIN, bajaEmail } from "@/lib/account-deletion/state"

const FK_VIOLATION = "23503"

// Frees the removed user's unique email so the person can be re-hired. Idempotent:
// scoped by id + org + deleted_at NOT NULL, and a no-op once the placeholder is in.
//
// RESTORE PROCEDURE (support): undoing a baja must also copy the original email
// back from audit_logs.changes.email_original (entity 'users', entity_id = user
// id, action 'DELETE'), after checking that no re-hired user took it meanwhile
// (users.email is UNIQUE). There is no restore helper on purpose.
async function liberarEmail(
  id: string,
  organizationId: string
): Promise<{ emailOriginal: string | null; yaLiberado: boolean; liberado: boolean }> {
  try {
    const { data: fila } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle()
    const emailOriginal: string | null = fila?.email ?? null
    if (!emailOriginal) return { emailOriginal: null, yaLiberado: false, liberado: false }
    if (emailOriginal.endsWith(`@${BAJA_EMAIL_DOMAIN}`)) {
      return { emailOriginal: null, yaLiberado: true, liberado: false }
    }
    const { data: filas, error: emailError } = await supabaseAdmin
      .from("users")
      .update({ email: bajaEmail(id) })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .not("deleted_at", "is", null)
      .select("id")
    if (emailError) {
      console.error("[eliminar-personal] liberar email:", emailError)
      return { emailOriginal, yaLiberado: false, liberado: false }
    }
    return { emailOriginal, yaLiberado: false, liberado: (filas?.length ?? 0) > 0 }
  } catch (err) {
    console.error("[eliminar-personal] liberar email:", err)
    return { emailOriginal: null, yaLiberado: false, liberado: false }
  }
}

async function auditarBaja(
  organizationId: string,
  actorId: string | null | undefined,
  id: string,
  changes: Record<string, unknown>
) {
  try {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: actorId ?? null,
      action: "DELETE",
      entity: "users",
      entity_id: id,
      changes,
    })
    if (auditError) console.error("[eliminar-personal] audit_logs:", auditError)
  } catch (err) {
    console.error("[eliminar-personal] audit_logs:", err)
  }
}

export type EliminarPersonalResult =
  | { ok: true; baja: boolean }
  | { ok: false; status: 404 | 409 | 500 }

// An admin removes a seller or technician. If nothing references the user the
// row is deleted. Otherwise (ventas, órdenes, caja... point at it with
// ON DELETE NO ACTION) the delete fails with 23503 and we fall back to the
// same soft-delete used by account self-deletion: deleted_at set, login
// blocked, history kept.
export async function eliminarPersonal(params: {
  id: string
  organizationId: string
  rol: "VENDEDOR" | "TECNICO"
  actorId?: string | null
}): Promise<EliminarPersonalResult> {
  const { id, organizationId, rol, actorId } = params

  const { error: deleteError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("rol", rol)

  if (!deleteError) return { ok: true, baja: false }

  if (deleteError.code !== FK_VIOLATION) {
    console.error("[eliminar-personal] delete:", deleteError)
    return { ok: false, status: 500 }
  }

  const { data: estado, error: rpcError } = await supabaseAdmin.rpc("solicitar_baja_usuario", {
    p_user_id: id,
  })
  if (rpcError) {
    console.error("[eliminar-personal] rpc:", rpcError)
    return { ok: false, status: 500 }
  }

  if (estado === "NOT_FOUND") return { ok: false, status: 404 }
  if (estado === "LAST_ADMIN") return { ok: false, status: 409 }
  if (estado === "ALREADY_DELETED") {
    // A failed first attempt can be retried. The baja audit already exists, so
    // only record a row if the email was actually freed now.
    const r = await liberarEmail(id, organizationId)
    if (r.liberado) {
      await auditarBaja(organizationId, actorId, id, {
        by_admin: true,
        soft: true,
        email_original: r.emailOriginal,
        email_liberado: true,
      })
    }
    return { ok: true, baja: true }
  }
  if (estado !== "OK") {
    console.error("[eliminar-personal] estado inesperado del RPC:", estado)
    return { ok: false, status: 500 }
  }

  // Notification tokens: best-effort, the baja is already done.
  const tablas = ["push_tokens", "web_push_subscriptions"]
  const limpiezas = await Promise.allSettled(
    tablas.map((t) => Promise.resolve(supabaseAdmin.from(t).delete().eq("user_id", id)))
  )
  limpiezas.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[eliminar-personal] limpieza de ${tablas[i]}:`, r.reason)
    } else if (r.value?.error) {
      console.error(`[eliminar-personal] limpieza de ${tablas[i]}:`, r.value.error)
    }
  })

  // Free the unique email so the person can be re-hired right away. Best-effort:
  // the original goes to the audit row; the name stays so history keeps its author.
  const r = await liberarEmail(id, organizationId)
  await auditarBaja(organizationId, actorId, id, {
    by_admin: true,
    soft: true,
    email_original: r.emailOriginal,
    email_liberado: r.liberado,
  })

  return { ok: true, baja: true }
}
