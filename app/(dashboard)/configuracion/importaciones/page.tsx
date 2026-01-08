import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ImportHistory } from "@/components/import/import-history"

export default async function ImportacionesPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historial de Importaciones</h1>
        <p className="text-muted-foreground">
          Revisa todas las importaciones realizadas en tu organización
        </p>
      </div>

      <ImportHistory />
    </div>
  )
}
