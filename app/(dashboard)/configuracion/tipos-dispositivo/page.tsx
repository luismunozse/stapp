import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { TiposDispositivoEditor } from "@/components/configuracion/tipos-dispositivo-editor"
import { PageShell } from "@/components/ui/page-shell"

export default async function TiposDispositivoPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <PageShell
      title="Tipos de dispositivo"
      description="Tipos de dispositivo para ordenes e inventario"
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <TiposDispositivoEditor />
    </PageShell>
  )
}
