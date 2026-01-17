"use client"

import { useState, useEffect } from "react"
import { Cookie, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCookieConsent, setCookieConsent, type CookieConsentType } from "@/lib/cookies"

export function CookieSettings() {
  const [consent, setConsent] = useState<CookieConsentType>(null)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    setConsent(getCookieConsent())
  }, [])

  const handleSavePreferences = (newConsent: CookieConsentType) => {
    setCookieConsent(newConsent)
    setConsent(newConsent)

    // Actualizar Google Analytics si está disponible
    if (typeof window !== "undefined" && window.gtag) {
      if (newConsent === "all") {
        window.gtag("consent", "update", {
          analytics_storage: "granted",
          ad_storage: "granted",
        })
      } else {
        window.gtag("consent", "update", {
          analytics_storage: "denied",
          ad_storage: "denied",
        })
      }
    }

    // Mostrar mensaje de guardado
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 3000)
  }

  const handleReset = () => {
    setCookieConsent(null)
    setConsent(null)
    setShowSaved(true)
    setTimeout(() => {
      setShowSaved(false)
      // Recargar para mostrar el banner nuevamente
      window.location.reload()
    }, 2000)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Cookie className="w-5 h-5 text-muted-foreground" />
          <CardTitle>Preferencias de Cookies</CardTitle>
        </div>
        <CardDescription>
          Gestiona cómo utilizamos las cookies en tu cuenta
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Estado actual */}
        {consent && (
          <div className="p-4 bg-muted rounded-lg border">
            <p className="text-sm font-medium text-foreground mb-1">
              Configuración actual
            </p>
            <p className="text-sm text-muted-foreground">
              {consent === "all" && "Aceptando todas las cookies"}
              {consent === "essential" && "Solo cookies esenciales"}
              {consent === "rejected" && "Cookies rechazadas"}
            </p>
          </div>
        )}

        {/* Opciones de cookies */}
        <div className="space-y-4">
          <div className="border rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium text-foreground mb-1">
                  Cookies esenciales
                </h4>
                <p className="text-sm text-muted-foreground">
                  Necesarias para el funcionamiento básico del sitio. No se pueden desactivar.
                </p>
              </div>
              <div className="ml-4 flex-shrink-0">
                <div className="w-12 h-6 bg-primary rounded-full flex items-center justify-end px-1">
                  <div className="w-4 h-4 bg-primary-foreground rounded-full" />
                </div>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium text-foreground mb-1">
                  Cookies de análisis
                </h4>
                <p className="text-sm text-muted-foreground">
                  Nos ayudan a entender cómo usas la aplicación para mejorarla.
                </p>
              </div>
              <div className="ml-4 flex-shrink-0">
                <div
                  className={`w-12 h-6 rounded-full flex items-center px-1 transition-colors ${
                    consent === "all"
                      ? "bg-primary justify-end"
                      : "bg-muted justify-start"
                  }`}
                >
                  <div className="w-4 h-4 bg-primary-foreground rounded-full" />
                </div>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium text-foreground mb-1">
                  Cookies de marketing
                </h4>
                <p className="text-sm text-muted-foreground">
                  Se utilizan para personalizar anuncios y medir su efectividad.
                </p>
              </div>
              <div className="ml-4 flex-shrink-0">
                <div
                  className={`w-12 h-6 rounded-full flex items-center px-1 transition-colors ${
                    consent === "all"
                      ? "bg-primary justify-end"
                      : "bg-muted justify-start"
                  }`}
                >
                  <div className="w-4 h-4 bg-primary-foreground rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <Button
            onClick={() => handleSavePreferences("essential")}
            variant="outline"
            className="flex-1"
          >
            Solo esenciales
          </Button>
          <Button
            onClick={() => handleSavePreferences("all")}
            className="flex-1"
          >
            Aceptar todas
          </Button>
        </div>

        <div className="pt-4 border-t">
          <Button
            onClick={handleReset}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            Restablecer preferencias
          </Button>
        </div>

        {/* Mensaje de guardado */}
        {showSaved && (
          <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-5">
            <Check className="w-5 h-5" />
            <span className="font-medium">Preferencias guardadas</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
