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
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Configuracion</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Personaliza la apariencia de tu aplicacion
        </p>
      </div>

      {/* Links a configuraciones adicionales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/configuracion/checklist">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">
                Checklist
              </CardTitle>
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <CardDescription className="text-[10px] sm:text-sm flex items-center justify-between">
                <span className="hidden sm:inline">Items del checklist de ingreso</span>
                <span className="sm:hidden">Checklist de ingreso</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/configuracion/billing">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">
                <span className="hidden sm:inline">Facturacion y Plan</span>
                <span className="sm:hidden">Facturacion</span>
              </CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <CardDescription className="text-[10px] sm:text-sm flex items-center justify-between">
                <span className="hidden sm:inline">Gestiona tu suscripcion y pagos</span>
                <span className="sm:hidden">Plan y pagos</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/configuracion/importaciones">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">
                Importaciones
              </CardTitle>
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <CardDescription className="text-[10px] sm:text-sm flex items-center justify-between">
                <span className="hidden sm:inline">Historial de importaciones CSV/Excel</span>
                <span className="sm:hidden">Historial CSV</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/configuracion/tipos-dispositivo">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">
                <span className="hidden sm:inline">Tipos de Dispositivo</span>
                <span className="sm:hidden">Dispositivos</span>
              </CardTitle>
              <Smartphone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <CardDescription className="text-[10px] sm:text-sm flex items-center justify-between">
                <span className="hidden sm:inline">Gestiona los tipos de dispositivo</span>
                <span className="sm:hidden">Tipos disponibles</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </CardDescription>
            </CardContent>
          </Card>
        </Link>
      </div>

      {!allowEdit && (
        <div className="bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 px-4 py-3 rounded-lg">
          <p className="text-sm font-medium">Las cuentas demo no pueden editar la configuración</p>
        </div>
      )}

      <ConfiguracionForm allowEdit={allowEdit} />

      <CookieSettings />
    </div>
  )
}
