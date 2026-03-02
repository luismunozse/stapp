import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { WhatsAppSetup } from "@/components/configuracion/whatsapp-setup"

export default async function WhatsAppConfigPage() {
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
        <h1 className="text-2xl sm:text-3xl font-bold">WhatsApp Business</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Conecta tu cuenta de WhatsApp Business para enviar notificaciones automaticas a tus clientes.
        </p>
      </div>

      <WhatsAppSetup />
    </div>
  )
}
