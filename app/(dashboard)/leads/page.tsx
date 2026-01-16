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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Leads del Chatbot</h1>
          <p className="text-muted-foreground">
            Gestiona los contactos capturados por Santi, tu asistente virtual
          </p>
        </div>
      </div>
      <LeadsList />
    </div>
  )
}
