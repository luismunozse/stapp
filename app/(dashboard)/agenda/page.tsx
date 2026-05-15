import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { AgendaView } from "@/components/agenda/agenda-view"

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
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Turnos de visitas, retiros y entregas
        </p>
      </div>
      <AgendaView />
    </div>
  )
}
