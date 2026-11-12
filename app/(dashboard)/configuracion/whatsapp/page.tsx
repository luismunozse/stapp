import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { WhatsAppSetup } from "@/components/configuracion/whatsapp-setup"
import { PageShell } from "@/components/ui/page-shell"

export default async function WhatsAppConfigPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <PageShell
      title="WhatsApp Business"
      description="Conectá tu cuenta de WhatsApp Business para enviar notificaciones automáticas a tus clientes."
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <WhatsAppSetup />
    </PageShell>
  )
}
