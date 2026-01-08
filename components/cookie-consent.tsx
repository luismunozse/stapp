"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { Cookie, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    // Solo mostrar en landing page y páginas públicas
    // NO mostrar en dashboard, órdenes, clientes, etc.
    const isPublicRoute =
      pathname === "/" ||
      pathname === "/landing" ||
      pathname.startsWith("/legal/")

    // No mostrar si no es ruta pública
    if (!isPublicRoute) {
      setShowBanner(false)
      setIsVisible(false)
      return
    }

    // Verificar si el usuario ya dio consentimiento
    const consent = localStorage.getItem("cookie-consent")
    if (consent) {
      return
    }

    // Mostrar el banner después de un pequeño delay para mejor UX
    let timer1: NodeJS.Timeout
    let timer2: NodeJS.Timeout

    timer1 = setTimeout(() => {
      setShowBanner(true)
      timer2 = setTimeout(() => setIsVisible(true), 100)
    }, 1000)

    return () => {
      clearTimeout(timer1)
      if (timer2) clearTimeout(timer2)
    }
  }, [pathname])

  const handleAcceptAll = () => {
    localStorage.setItem("cookie-consent", "all")
    hideBanner()
    // Aquí podrías inicializar servicios de analytics, etc.
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("consent", "update", {
        analytics_storage: "granted",
        ad_storage: "granted",
      })
    }
  }

  const handleAcceptEssential = () => {
    localStorage.setItem("cookie-consent", "essential")
    hideBanner()
    // Solo cookies esenciales
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
      })
    }
  }

  const handleReject = () => {
    localStorage.setItem("cookie-consent", "rejected")
    hideBanner()
    // Rechazar cookies no esenciales
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
      })
    }
  }

  const hideBanner = () => {
    setIsVisible(false)
    setTimeout(() => setShowBanner(false), 300)
  }

  if (!showBanner) return null

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleReject}
      />

      {/* Banner */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 transform ${
          isVisible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
        }`}
      >
        <div className="bg-white border-t border-gray-200 shadow-2xl">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
              {/* Icon y texto */}
              <div className="flex-1 flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Cookie className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Utilizamos cookies
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Utilizamos cookies esenciales para el funcionamiento del sitio y cookies
                    opcionales para mejorar tu experiencia. Puedes elegir qué cookies aceptar.{" "}
                    <Link
                      href="/legal/cookies"
                      className="text-blue-600 hover:text-blue-700 underline font-medium"
                    >
                      Más información
                    </Link>
                  </p>
                </div>
              </div>

              {/* Botones */}
              <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto lg:flex-shrink-0">
                <Button
                  variant="outline"
                  onClick={handleReject}
                  className="w-full sm:w-auto order-2 sm:order-1"
                >
                  Rechazar todo
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAcceptEssential}
                  className="w-full sm:w-auto order-3 sm:order-2"
                >
                  Solo esenciales
                </Button>
                <Button
                  onClick={handleAcceptAll}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white order-1 sm:order-3"
                >
                  Aceptar todo
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
