"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { isNativePlatform } from "@/lib/capacitor"

const UPDATE_TOAST_ID = "sw-update-available"
const VERSION_CHECK_INTERVAL = 5 * 60 * 1000 // 5 min
const LOADED_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"

/**
 * Dueño del ciclo de vida del Service Worker + detección de nueva versión.
 *
 * Dos disparadores, un solo toast "Actualizar":
 *  1. Version-poll: compara el build-id con el que sirve /api/version. Es el
 *     que se activa en deploys normales de features (el bundle JS cambia pero
 *     sw.js no, así que el SW solo no alcanza).
 *  2. SW-update: detecta un Service Worker nuevo esperando (cuando sw.js sí
 *     cambia) y reusa el mensaje SKIP_WAITING que el SW ya soporta.
 *
 * Al confirmar el toast: activa el SW que esté esperando y recarga una sola vez
 * (vía `controllerchange`); si no hay SW esperando, recarga directo.
 *
 * No corre en Capacitor (app nativa) ni sin soporte de SW.
 */
export function PWAUpdater() {
  const reloadingRef = useRef(false)
  const promptedRef = useRef(false)

  useEffect(() => {
    if (isNativePlatform()) return
    if (typeof window === "undefined") return

    const hasSW = "serviceWorker" in navigator
    let registration: ServiceWorkerRegistration | null = null

    const reloadOnce = () => {
      if (reloadingRef.current) return
      reloadingRef.current = true
      window.location.reload()
    }

    // Cuando el SW nuevo toma control, recargamos una única vez.
    const onControllerChange = () => reloadOnce()
    if (hasSW) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)
    }

    const applyUpdate = async () => {
      if (hasSW) {
        try {
          const reg = registration ?? (await navigator.serviceWorker.getRegistration())
          if (reg?.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" }) // → controllerchange → reload
            return
          }
        } catch {
          /* ignore */
        }
      }
      reloadOnce()
    }

    const promptUpdate = () => {
      if (promptedRef.current) return
      promptedRef.current = true
      toast("Hay una nueva versión disponible", {
        id: UPDATE_TOAST_ID,
        description: "Actualizá para usar las últimas mejoras.",
        duration: Infinity,
        action: {
          label: "Actualizar",
          onClick: () => void applyUpdate(),
        },
      })
    }

    // --- 1) Service Worker: registro + detección de worker en espera ---
    if (hasSW) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          registration = reg
          if (reg.waiting && navigator.serviceWorker.controller) promptUpdate()
          reg.addEventListener("updatefound", () => {
            const installing = reg.installing
            if (!installing) return
            installing.addEventListener("statechange", () => {
              // `controller` presente = ACTUALIZACIÓN, no primera instalación.
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                promptUpdate()
              }
            })
          })
        })
        .catch((err) => console.log("Error al registrar Service Worker:", err))
    }

    // --- 2) Version-poll: detecta deploys nuevos comparando build-id ---
    const checkVersion = async () => {
      if (promptedRef.current) return
      try {
        const res = await fetch("/api/version", { cache: "no-store" })
        if (!res.ok) return
        const { buildId } = (await res.json()) as { buildId?: string }
        if (buildId && buildId !== "dev" && buildId !== LOADED_BUILD_ID) {
          promptUpdate()
        }
      } catch {
        /* sin conexión: reintenta en el próximo ciclo */
      }
    }

    const checkAll = () => {
      registration?.update().catch(() => {})
      void checkVersion()
    }

    const interval = setInterval(checkAll, VERSION_CHECK_INTERVAL)
    const onFocus = () => checkAll()
    const onVisible = () => {
      if (document.visibilityState === "visible") checkAll()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      if (hasSW) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      }
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(interval)
    }
  }, [])

  return null
}
