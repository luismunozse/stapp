import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { TecnicosList } from "@/components/tecnicos/tecnicos-list"
import { PageShell } from "@/components/ui/page-shell"

export default async function TecnicosPage() {
  const session = await auth()
  const role = session?.user?.role
  const userId = session?.user?.id

  if (role === "TECNICO" && userId) {
    redirect(`/tecnicos/${userId}`)
  }

  return (
    <PageShell title="Técnicos" description="Gestiona los técnicos y sus asignaciones">
      <TecnicosList />
    </PageShell>
  )
}
