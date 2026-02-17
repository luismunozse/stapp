import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { TiposDispositivoEditor } from "@/components/configuracion/tipos-dispositivo-editor"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

export default async function TiposDispositivoPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
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
        <h1 className="text-2xl sm:text-3xl font-bold">Tipos de Dispositivo</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Tipos de dispositivo para ordenes e inventario
        </p>
      </div>
      <TiposDispositivoEditor />
    </div>
  )
}
