import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ImportHistory } from "@/components/import/import-history"
import { hasPlanFeature } from "@/lib/subscriptions"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

export default async function ImportacionesPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  const hasImport = await hasPlanFeature(session.user.organizationId, "import_export")
  if (!hasImport) {
    redirect("/configuracion/billing?upgrade=importaciones")
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Link
          href="/configuracion"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Volver a Configuracion
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold">Importaciones</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Revisa todas las importaciones realizadas
        </p>
      </div>

      <ImportHistory />
    </div>
  )
}
