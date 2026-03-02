import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { KioskConfigView } from "@/components/kiosco/kiosk-config-view"

export default async function KioskConfigPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/dashboard")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Modo Kiosco</h1>
        <p className="text-muted-foreground">
          Configura pantallas de estado para mostrar en tu local.
        </p>
      </div>
      <KioskConfigView />
    </div>
  )
}
