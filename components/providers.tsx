"use client"

import { useEffect } from "react"
import { SessionProvider } from "next-auth/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ConfirmProvider } from "@/contexts/confirm-context"
import { SessionRefresher } from "@/components/auth/session-refresher"
import { CurrencyProvider } from "@/contexts/currency-context"
import { PushNotificationRegistrar } from "@/components/push-notification-registrar"
import { syncStatusBarToTheme, hideSplashScreen } from "@/lib/capacitor"
import { Toaster } from "sonner"

/**
 * Sincroniza el StatusBar nativo con la clase `dark` en <html>.
 * El tema en STApp se aplica toggling document.documentElement.classList,
 * no via React context — por eso usamos MutationObserver.
 * También oculta el splash screen nativo cuando el árbol React está listo
 * (launchAutoHide: false en capacitor.config.ts).
 */
function CapacitorThemeSync() {
  useEffect(() => {
    const root = document.documentElement
    const sync = () => syncStatusBarToTheme(root.classList.contains("dark"))

    // Sync inicial
    sync()
    // Cierra el splash ahora que el árbol React está montado y el tema aplicado
    void hideSplashScreen()

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "class") {
          sync()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <SessionRefresher>
        <CurrencyProvider>
          <ConfirmProvider>
            <ModalProvider>
              <CapacitorThemeSync />
              {children}
              <PushNotificationRegistrar />
              <Toaster position="top-right" richColors closeButton />
            </ModalProvider>
          </ConfirmProvider>
        </CurrencyProvider>
      </SessionRefresher>
    </SessionProvider>
  )
}
