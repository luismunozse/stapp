import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { TemplateEditor } from "@/components/checklist/template-editor"
import { PageShell } from "@/components/ui/page-shell"

export default async function ChecklistConfigPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <PageShell
      title="Checklist de recepción"
      description="Items que apareceran al registrar el ingreso de un equipo"
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <TemplateEditor />
    </PageShell>
  )
}
