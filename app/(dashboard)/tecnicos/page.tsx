import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { TecnicosList } from "@/components/tecnicos/tecnicos-list"

export default async function TecnicosPage() {
  const session = await auth()
  const role = session?.user?.role
  const userId = session?.user?.id

  if (role === "TECNICO" && userId) {
    redirect(`/tecnicos/${userId}`)
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Técnicos</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gestiona los técnicos y sus asignaciones
        </p>
      </div>
      <TecnicosList />
    </div>
  )
}
