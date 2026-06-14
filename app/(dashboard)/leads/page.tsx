import { LeadsList } from "@/components/leads/leads-list"
import { requireAuth } from "@/lib/auth-utils"
import { redirect } from "next/navigation"
import { PageShell } from "@/components/ui/page-shell"

export const metadata = {
  title: "Leads del Chatbot - STApp",
  description: "Gestiona los contactos capturados por Santi",
}

export default async function LeadsPage() {
  const { error } = await requireAuth()
  if (error) redirect("/login")

  return (
    <PageShell title="Leads del Chatbot" description="Contactos capturados por Santi, tu asistente virtual">
      <LeadsList />
    </PageShell>
  )
}
