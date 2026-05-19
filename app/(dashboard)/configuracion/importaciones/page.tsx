import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ImportHistory } from "@/components/import/import-history"
import { hasPlanFeature } from "@/lib/subscriptions"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"
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
    return (
      <div className="py-8 px-4">
        <FeatureLockedView
          featureName="Importaciones"
          description="Cargá clientes e inventario desde Excel/CSV en lugar de uno por uno. Disponible en plan Profesional."
          benefits={[
            "Importar miles de clientes desde planilla en segundos",
            "Subir inventario completo con códigos, precios y stock",
            "Validación previa con preview antes de confirmar",
            "Historial de importaciones con detalle de errores",
          ]}
          upgradeKey="importaciones"
        />
      </div>
    )
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
