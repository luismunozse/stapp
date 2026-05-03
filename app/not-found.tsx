import Link from "next/link"
import { Button } from "@/components/ui/button"
import { STAppLogo } from "@/components/shared/stapp-logo"
import { Home, ArrowLeft, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 dark:bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center mb-2">
          <STAppLogo size="md" />
        </div>

        <div className="space-y-2">
          <h1 className="text-7xl font-bold text-primary">404</h1>
          <h2 className="text-2xl font-semibold">Página no encontrada</h2>
          <p className="text-muted-foreground">
            La ruta que intentás abrir no existe o fue movida. Verificá la URL o volvé al panel principal.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <Button asChild variant="default">
            <Link href="/superadmin/dashboard">
              <Home className="h-4 w-4 mr-2" />
              Ir al Dashboard
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver al inicio
            </Link>
          </Button>
        </div>

        <div className="pt-4 text-xs text-muted-foreground flex items-center justify-center gap-1">
          <Search className="h-3 w-3" />
          <span>Tip: usá Ctrl+K para abrir la búsqueda global desde el panel</span>
        </div>
      </div>
    </div>
  )
}
