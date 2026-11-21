"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { isNativePlatform } from "@/lib/capacitor"

/**
 * Maneja el botón "Atrás" del hardware en Android.
 * - Si hay un Radix Dialog abierto, lo cierra (despacha Escape).
 * - Si una pantalla a pantalla completa escucha "app:back" y lo cancela
 *   (alta de orden: paso anterior o cerrar), no navega.
 * - En el Inicio (/dashboard) minimiza la app (queda abierta, con la sesión).
 * - En otra pantalla vuelve a la anterior, o al Inicio si no hay historial.
 */
export function CapacitorBackButtonHandler() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!isNativePlatform()) return
    let sub: { remove: () => void } | null = null
    let cancelled = false

    ;(async () => {
      try {
        const { App } = await import("@capacitor/app")
        const handle = await App.addListener("backButton", ({ canGoBack }) => {
          // Si hay un Radix Dialog abierto, cerrarlo en lugar de navegar.
          const openDialog = document.querySelector('[role="dialog"][data-state="open"]')
          if (openDialog) {
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
            )
            return
          }
          // Full-screen in-page flows (e.g. the new-order form) handle back
          // themselves — previous step or close — by cancelling this event.
          const appBack = new Event("app:back", { cancelable: true })
          if (!window.dispatchEvent(appBack)) return
          // Home screen: send the app to the background like any Android app.
          // Going "back" from here walked into /login (the history before the
          // panel), which looked like a logout; exiting also lost the place.
          if (pathname === "/dashboard") {
            App.minimizeApp()
            return
          }
          if (canGoBack) {
            router.back()
          } else {
            router.replace("/dashboard")
          }
        })
        if (cancelled) {
          handle.remove()
        } else {
          sub = handle
        }
      } catch {
        /* @capacitor/app no disponible */
      }
    })()

    return () => {
      cancelled = true
      sub?.remove()
    }
  }, [router, pathname])

  return null
}
