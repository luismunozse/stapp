import { LeadsList } from "@/components/leads/leads-list"
import { requireAuth } from "@/lib/auth-utils"
import { redirect } from "next/navigation"

export const metadata = {
  title: "Leads del Chatbot - STApp",
  description: "Gestiona los contactos capturados por Santi",
}

export default async function LeadsPage() {
  const { error } = await requireAuth()
  if (error) redirect("/login")

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Leads del Chatbot</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Contactos capturados por Santi, tu asistente virtual
        </p>
      </div>
      <LeadsList />
    </div>
  )
}
