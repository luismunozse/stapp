"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { isNativePlatform, getPlatform } from "@/lib/capacitor"

/**
 * Hook que registra push notifications en plataformas nativas (Capacitor).
 * Requiere @capacitor/push-notifications instalado.
 * En web no hace nada.
 */
export function usePushNotifications() {
  const { data: session } = useSession()
  const registeredRef = useRef(false)

  useEffect(() => {
    if (!session?.user?.id || !isNativePlatform() || registeredRef.current) return

    let cleanup: (() => void) | undefined

    async function setupPush() {
      try {
        // Dynamic import - only resolves when @capacitor/push-notifications is installed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import("@capacitor/push-notifications" as any)
        const PushNotifications = mod.PushNotifications

        const permResult = await PushNotifications.requestPermissions()
        if (permResult.receive !== "granted") return

        await PushNotifications.register()

        // Listener para recibir el token
        const tokenListener = await PushNotifications.addListener("registration", async (token: { value: string }) => {
          registeredRef.current = true
          try {
            await fetch("/api/push-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: token.value,
                platform: getPlatform(),
              }),
            })
          } catch (err) {
            console.error("Error registering push token:", err)
          }
        })

        const errorListener = await PushNotifications.addListener("registrationError", (err: unknown) => {
          console.error("Push registration error:", err)
        })

        cleanup = () => {
          tokenListener.remove()
          errorListener.remove()
        }
      } catch {
        // @capacitor/push-notifications not installed - skip silently
      }
    }

    setupPush()

    return () => {
      cleanup?.()
    }
  }, [session?.user?.id])
}
