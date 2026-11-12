import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { KioskConfigView } from "@/components/kiosco/kiosk-config-view"
import { PageShell } from "@/components/ui/page-shell"

export default async function KioskConfigPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/dashboard")

  return (
    <PageShell
      title="Modo kiosco"
      description="Configura pantallas de estado para mostrar en tu local."
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <KioskConfigView />
    </PageShell>
  )
}
