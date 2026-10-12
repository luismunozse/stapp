import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"
import { ANON_EMAIL_DOMAIN, DELETION_REASON, graceCutoff } from "@/lib/account-deletion/state"
import { purgeOrganization } from "@/lib/account-deletion/purge-organization"
import { anonymizeUser } from "@/lib/account-deletion/anonymize-user"

export const maxDuration = 60

// Lotes acotados para respetar los 60 s. Lo que no entra hoy entra mañana.
const ORG_BATCH = 5
const USER_BATCH = 50
const BUDGET_MS = 45_000

// Interruptor de seguridad, leído en cada request. Mientras no sea "true" el
// cron es DRY RUN: informa candidatos y no cancela, borra ni anonimiza nada.
const isEnabled = () => process.env.ACCOUNT_DELETION_PURGE_ENABLED === "true"

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const deadline = now.getTime() + BUDGET_MS
    const cutoff = graceCutoff(now).toISOString()
    const dryRun = !isEnabled()

    const results = {
      dryRun,
      orgs: { candidates: 0, purged: 0, skipped: 0, failed: [] as Array<{ id: string; step: string; error: string }> },
      users: { candidates: 0, anonymized: 0, failed: [] as Array<{ id: string; error: string }> },
    }

    // Talleres: pedido de eliminación vencido Y todavía archivado. Los archivados
    // por inactividad (auto-archive-dormant) no tienen deletion_requested_at.
    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from("organizations")
      .select("id, slug")
      .not("deletion_requested_at", "is", null)
      .lt("deletion_requested_at", cutoff)
      .not("deleted_at", "is", null)
      .order("deletion_requested_at", { ascending: true })
      .limit(ORG_BATCH)
    if (orgsError) throw new Error(`organizations: ${orgsError.message}`)
    results.orgs.candidates = (orgs ?? []).length

    // Usuarios: baja vencida y todavía sin anonimizar.
    const { data: users, error: usersError } = await supabaseAdmin
      .from("users")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .not("email", "like", `%@${ANON_EMAIL_DOMAIN}`)
      .order("deleted_at", { ascending: true })
      .limit(USER_BATCH)
    if (usersError) throw new Error(`users: ${usersError.message}`)
    results.users.candidates = (users ?? []).length

    if (!dryRun) {
      for (const org of orgs ?? []) {
        if (Date.now() >= deadline) break
        try {
          const r = await purgeOrganization(org.id, { deadline, expectArchived: true })
          console.log(JSON.stringify({ cron: "account-deletion-purge", kind: "org", id: org.id, slug: org.slug, result: r }))
          if (!r.ok) {
            results.orgs.failed.push({ id: org.id, step: r.step, error: r.error })
            if (r.error.startsWith("not-archived-anymore")) {
              // Suscripciones y storage ya purgados pero la org fue restaurada: requiere revisión humana.
              console.error(`[account-deletion-purge] MANUAL ATTENTION: org ${org.id} (${org.slug}) restaurada a mitad de la purga`)
            }
          } else if (r.skipped) {
            results.orgs.skipped++
          } else {
            results.orgs.purged++
            // La fila de la org ya no existe: el log queda sin organization_id, igual que la purga manual.
            const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
              organization_id: null,
              user_id: null,
              action: "DELETE",
              entity: "organizations",
              entity_id: org.id,
              changes: { auto: true, reason: DELETION_REASON, slug: org.slug, removed_files: r.removedFiles },
            })
            if (auditError) console.error(`[account-deletion-purge] audit_logs org ${org.id}: ${auditError.message}`)
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          console.error(`[account-deletion-purge] org ${org.id} lanzó excepción: ${error}`)
          results.orgs.failed.push({ id: org.id, step: "exception", error })
        }
      }

      for (const user of users ?? []) {
        if (Date.now() >= deadline) break
        try {
          const r = await anonymizeUser(user.id)
          console.log(JSON.stringify({ cron: "account-deletion-purge", kind: "user", id: user.id, result: r }))
          if (r.ok) results.users.anonymized++
          else results.users.failed.push({ id: user.id, error: r.error })
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          console.error(`[account-deletion-purge] user ${user.id} lanzó excepción: ${error}`)
          results.users.failed.push({ id: user.id, error })
        }
      }
    }

    return NextResponse.json({ success: true, results, timestamp: now.toISOString() })
  } catch (error) {
    console.error("Error en cron account-deletion-purge:", error)
    return NextResponse.json({ error: "Error procesando eliminaciones de cuenta" }, { status: 500 })
  }
}
