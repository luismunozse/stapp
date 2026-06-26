import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canEditConfiguration } from "@/lib/auth-utils"
import { PageShell } from "@/components/ui/page-shell"
import { RecargosMetodoForm } from "@/components/configuracion/recargos-metodo-form"

export default async function RecargosMetodoPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/configuracion")
  if (!(await canEditConfiguration())) redirect("/configuracion")

  return (
    <PageShell
      title="Recargos por método de pago"
      description="Precio según cómo paga el cliente"
      backHref="/configuracion"
      backLabel="Configuración"
    >
      <RecargosMetodoForm />
    </PageShell>
  )
}
