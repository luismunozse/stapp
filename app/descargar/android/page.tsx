import Link from "next/link"
import Image from "next/image"
import { Shield, Zap, ArrowLeft, CheckCircle2, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { STAppLogo } from "@/components/shared/stapp-logo"

// The Android app is a closed beta on Google Play, so this page explains how to
// join it instead of offering an APK. The sign-up itself happens in the panel
// (ApkDownloadBanner + lib/android-beta.ts), because it needs a logged-in account.
const PASOS = [
  "Creá tu cuenta gratis en STApp, o iniciá sesión si ya tenés una.",
  "En el panel vas a ver el aviso “Sumate a la beta de Android”. Dejá ahí el correo de tu cuenta de Google.",
  "Cuando te sumemos a la lista de prueba, el mismo aviso te muestra el enlace de invitación. Aceptala con esa cuenta de Google.",
  "Instalá STApp desde Google Play e ingresá con tu usuario de siempre.",
]

export default function DescargarAndroidPage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-primary/5 to-background">
      {/* Header */}
      <div className="container mx-auto px-4 py-6 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>
        <STAppLogo size="sm" />
      </div>

      {/* Hero */}
      <div className="container mx-auto px-4 pb-16">
        <div className="max-w-2xl mx-auto text-center space-y-4 md:space-y-8">
          {/* Logo */}
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/25">
            <Image
              src="/icon-512.svg"
              alt="STApp"
              width={72}
              height={72}
              className="drop-shadow-md"
            />
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
              <span className="text-primary">ST</span>App para Android
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              Llevá tu taller en el bolsillo. Gestioná órdenes, clientes e inventario desde tu celular.
            </p>
          </div>

          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border bg-card px-3 py-1 text-sm font-medium">
              Beta en Google Play
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button asChild size="lg" className="h-14 px-8 text-lg shadow-lg shadow-primary/25">
                <Link href="/registro">Crear cuenta gratis</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-14 px-8 text-lg">
                <Link href="/login">Ya tengo cuenta</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Requiere Android 8.0 o superior. Mientras tanto, STApp funciona completa desde el navegador del celular.
            </p>
          </div>

          {/* Features */}
          <div className="grid sm:grid-cols-3 gap-6 pt-8">
            <div className="flex flex-col items-center gap-3 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">Acceso rápido</h3>
              <p className="text-sm text-muted-foreground text-center">
                Abrí la app directamente desde tu pantalla de inicio sin pasar por el navegador
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">Segura y confiable</h3>
              <p className="text-sm text-muted-foreground text-center">
                Misma seguridad que la versión web con encriptación de datos
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Smartphone className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">Todas las funciones</h3>
              <p className="text-sm text-muted-foreground text-center">
                Órdenes, clientes, inventario, facturación y más desde tu celular
              </p>
            </div>
          </div>

          {/* Install instructions */}
          <div className="max-w-md mx-auto text-left space-y-4 pt-4">
            <h2 className="text-lg font-semibold text-center">Cómo sumarte a la beta</h2>
            <ol className="space-y-3">
              {PASOS.map((paso) => (
                <li key={paso} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-sm text-muted-foreground">{paso}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
