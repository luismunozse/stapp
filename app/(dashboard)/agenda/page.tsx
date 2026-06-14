import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { AgendaView } from "@/components/agenda/agenda-view"
import { PageShell } from "@/components/ui/page-shell"

export default async function AgendaPage() {
  const { error, organizationId } = await requireAuth()
  if (error || !organizationId) redirect("/dashboard")

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("modulo_agenda")
    .eq("id", organizationId)
    .single()

  if (!org?.modulo_agenda) redirect("/dashboard")

  return (
    <PageShell title="Agenda" description="Turnos de visitas, retiros y entregas">
      <AgendaView />
    </PageShell>
  )
}
