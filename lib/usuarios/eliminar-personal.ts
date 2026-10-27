import { supabaseAdmin } from "@/lib/supabase"
import { bajaEmail } from "@/lib/account-deletion/state"

const FK_VIOLATION = "23503"

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
  if (estado === "ALREADY_DELETED") return { ok: true, baja: true }
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
  let emailOriginal: string | null = null
  let emailLiberado = false
  try {
    const { data: fila } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle()
    emailOriginal = fila?.email ?? null
    if (emailOriginal) {
      const { error: emailError } = await supabaseAdmin
        .from("users")
        .update({ email: bajaEmail(id) })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .not("deleted_at", "is", null)
      if (emailError) console.error("[eliminar-personal] liberar email:", emailError)
      else emailLiberado = true
    }
  } catch (err) {
    console.error("[eliminar-personal] liberar email:", err)
  }

  try {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: actorId ?? null,
      action: "DELETE",
      entity: "users",
      entity_id: id,
      changes: { by_admin: true, soft: true, email_original: emailOriginal, email_liberado: emailLiberado },
    })
    if (auditError) console.error("[eliminar-personal] audit_logs:", auditError)
  } catch (err) {
    console.error("[eliminar-personal] audit_logs:", err)
  }

  return { ok: true, baja: true }
}
