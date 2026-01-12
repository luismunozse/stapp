import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ConfiguracionForm } from "@/components/configuracion/configuracion-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CookieSettings } from "@/components/cookie-settings"
import Link from "next/link"
import { ClipboardCheck, ChevronRight, CreditCard, FileSpreadsheet, Smartphone } from "lucide-react"
import { canEditConfiguration } from "@/lib/auth-utils"

export default async function ConfiguracionPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  const allowEdit = await canEditConfiguration()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configuracion</h1>
        <p className="text-muted-foreground">
          Personaliza la apariencia de tu aplicacion
        </p>
      </div>

      {/* Links a configuraciones adicionales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/configuracion/checklist">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Checklist de Recepcion
              </CardTitle>
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription className="flex items-center justify-between">
                Configure los items del checklist de ingreso
                <ChevronRight className="h-4 w-4" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/configuracion/billing">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Facturacion y Plan
              </CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription className="flex items-center justify-between">
                Gestiona tu suscripcion y pagos
                <ChevronRight className="h-4 w-4" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/configuracion/importaciones">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Importaciones
              </CardTitle>
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription className="flex items-center justify-between">
                Ver historial de importaciones CSV/Excel
                <ChevronRight className="h-4 w-4" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/configuracion/tipos-dispositivo">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Tipos de Dispositivo
              </CardTitle>
              <Smartphone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription className="flex items-center justify-between">
                Gestiona los tipos de dispositivo disponibles
                <ChevronRight className="h-4 w-4" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>
      </div>

      {!allowEdit && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          <p className="text-sm font-medium">Las cuentas demo no pueden editar la configuración</p>
        </div>
      )}

      <ConfiguracionForm allowEdit={allowEdit} />

      <CookieSettings />
    </div>
  )
}
