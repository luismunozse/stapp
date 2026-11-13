import { LeadsList } from "@/components/leads/leads-list"
import { requireAuth } from "@/lib/auth-utils"
import { redirect } from "next/navigation"
import { PageShell } from "@/components/ui/page-shell"

export const metadata = {
  title: "Contactos del chatbot - STApp",
  description: "Gestioná los contactos capturados por Santi",
}

export default async function LeadsPage() {
  const { error } = await requireAuth()
  if (error) redirect("/login")

  return (
    <PageShell title="Contactos del chatbot" description="Contactos capturados por Santi, tu asistente virtual">
      <LeadsList />
    </PageShell>
  )
}
