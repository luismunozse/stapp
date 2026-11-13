import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ImportHistory } from "@/components/import/import-history"
import { hasPlanFeature } from "@/lib/subscriptions"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"
import { PageShell } from "@/components/ui/page-shell"

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
    <PageShell
      title="Importaciones"
      description="Revisá todas las importaciones realizadas"
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <ImportHistory />
    </PageShell>
  )
}
