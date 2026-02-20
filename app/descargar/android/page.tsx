"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { Download, Shield, Zap, ArrowLeft, CheckCircle2, Loader2, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { STAppLogo } from "@/components/shared/stapp-logo"

interface ApkInfo {
  available: boolean
  version?: string
  size?: string
  updatedAt?: string
}

export default function DescargarAndroidPage() {
  const [apkInfo, setApkInfo] = useState<ApkInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/download/apk-info")
      .then((res) => res.json())
      .then((data) => setApkInfo(data))
      .catch(() => setApkInfo({ available: false }))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      {/* Header */}
      <div className="container mx-auto px-4 py-6 flex items-center justify-between">
        <Link
          href="/landing"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>
        <STAppLogo size="sm" />
      </div>

      {/* Hero */}
      <div className="container mx-auto px-4 pb-16">
        <div className="max-w-2xl mx-auto text-center space-y-8">
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

          {/* Download button */}
          <div className="space-y-3">
            {loading ? (
              <Button size="lg" disabled className="h-14 px-8 text-lg">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Verificando disponibilidad...
              </Button>
            ) : apkInfo?.available ? (
              <>
                <a href="/api/download/apk">
                  <Button
                    size="lg"
                    className="h-14 px-8 text-lg shadow-lg shadow-primary/25"
                  >
                    <Download className="mr-2 h-5 w-5" />
                    Descargar APK
                  </Button>
                </a>
                <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                  {apkInfo.version && <span>Versión {apkInfo.version}</span>}
                  {apkInfo.size && (
                    <>
                      <span className="text-border">•</span>
                      <span>{apkInfo.size}</span>
                    </>
                  )}
                  <span className="text-border">•</span>
                  <span>Android 8.0+</span>
                </div>
              </>
            ) : (
              <div className="p-6 rounded-xl border bg-card text-card-foreground">
                <p className="text-muted-foreground">
                  La APK aún no está disponible para descarga. Estamos preparando la versión final.
                </p>
              </div>
            )}
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
            <h2 className="text-lg font-semibold text-center">Cómo instalar</h2>
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">
                  Descargá el archivo APK tocando el botón de arriba
                </span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">
                  Si tu celular lo pide, habilitá la instalación desde &quot;Orígenes desconocidos&quot; en Configuración
                </span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">
                  Abrí el archivo descargado y tocá &quot;Instalar&quot;
                </span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">
                  ¡Listo! Iniciá sesión con tu cuenta de STApp
                </span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
