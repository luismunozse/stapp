"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { isNativePlatform } from "@/lib/capacitor"

type PermissionState = "default" | "granted" | "denied" | "unsupported"

interface UseWebPushResult {
  /** Browser support + capability status. */
  supported: boolean
  /** Current Notification.permission, plus "unsupported". */
  permission: PermissionState
  /** True when a PushSubscription is registered on this device. */
  subscribed: boolean
  /** In-flight indicator for subscribe/unsubscribe calls. */
  loading: boolean
  /** Last error message, if any. */
  error: string | null
  /** Prompt for permission and POST subscription to server. */
  subscribe: () => Promise<boolean>
  /** Tear down PushSubscription + tell server. */
  unsubscribe: () => Promise<boolean>
}

function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false
  if (isNativePlatform()) return false // native uses @capacitor/push-notifications instead
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function arrayBufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return ""
  const bytes = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Web Push subscription manager for PWA users. No-op on native (Capacitor).
 *
 * Lifecycle:
 *  1. Mount → reflect current Notification.permission + existing subscription.
 *  2. subscribe() → request permission, register SW push subscription using
 *     VAPID public key, POST endpoint+keys to /api/push/web-subscribe.
 *  3. unsubscribe() → tear down + DELETE on server.
 *
 * Also listens for PUSH_NAVIGATE messages from sw.js (issued when the SW
 * can't directly navigate an existing client) and routes via Next router.
 */
export function useWebPush(): UseWebPushResult {
  const { data: session } = useSession()
  const router = useRouter()
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<PermissionState>("default")
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initial probe + listen for SW-relayed navigations.
  useEffect(() => {
    if (!isWebPushSupported()) {
      setSupported(false)
      setPermission("unsupported")
      return
    }
    setSupported(true)
    setPermission(Notification.permission as PermissionState)

    let cancelled = false
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (!cancelled) setSubscribed(!!sub) })
      .catch(() => { /* ignore */ })

    const onMessage = (e: MessageEvent) => {
      const data = e.data
      if (data?.type === "PUSH_NAVIGATE" && typeof data.path === "string") {
        if (data.path.startsWith("/")) router.push(data.path)
        else if (/^https?:\/\//i.test(data.path)) window.location.href = data.path
      }
    }
    navigator.serviceWorker?.addEventListener("message", onMessage)

    return () => {
      cancelled = true
      navigator.serviceWorker?.removeEventListener("message", onMessage)
    }
  }, [router])

  const subscribe = useCallback(async (): Promise<boolean> => {
    setError(null)
    if (!isWebPushSupported()) {
      setError("Notificaciones no soportadas en este navegador")
      return false
    }
    if (!session?.user?.id) {
      setError("Inicia sesión para activar notificaciones")
      return false
    }
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) {
      setError("VAPID public key no configurada (NEXT_PUBLIC_VAPID_PUBLIC_KEY)")
      return false
    }

    setLoading(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm as PermissionState)
      if (perm !== "granted") {
        setError(perm === "denied"
          ? "Permiso denegado. Habilítalo en ajustes del navegador."
          : "Permiso no concedido")
        return false
      }

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        })
      }

      const p256dh = arrayBufferToBase64Url(sub.getKey("p256dh"))
      const auth = arrayBufferToBase64Url(sub.getKey("auth"))

      const res = await fetch("/api/push/web-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh,
          auth,
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        // Server rejected; tear down local sub to avoid orphan.
        await sub.unsubscribe().catch(() => {})
        const body = await res.json().catch(() => ({}))
        setError(body?.error || "Error registrando subscription")
        return false
      }
      setSubscribed(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setError(null)
    if (!isWebPushSupported()) return false

    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch("/api/push/web-subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setSubscribed(false)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { supported, permission, subscribed, loading, error, subscribe, unsubscribe }
}
