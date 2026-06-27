import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canEditConfiguration } from "@/lib/auth-utils"
import { PageShell } from "@/components/ui/page-shell"
import { VocabularioForm } from "@/components/configuracion/vocabulario-form"

export default async function VocabularioPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/configuracion")
  if (!(await canEditConfiguration())) redirect("/configuracion")

  return (
    <PageShell
      title="Vocabulario"
      description="Personalizá los términos según tu rubro"
      backHref="/configuracion"
      backLabel="Configuración"
    >
      <VocabularioForm />
    </PageShell>
  )
}
