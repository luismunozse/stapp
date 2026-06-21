"use client"

import { useEffect, useRef, useState } from "react"

interface UsePullToRefreshOptions {
  /** Callback de refresco. Si devuelve Promise, el spinner se mantiene hasta resolver. */
  onRefresh: () => Promise<unknown> | unknown
  /** Distancia (px) a superar para disparar el refresco. */
  threshold?: number
  /** Tope visual del pull (px). */
  maxPull?: number
  /** Desactiva el gesto (ej: cuando hay un modal abierto). */
  disabled?: boolean
}

/**
 * Pull-to-refresh para el scroll de la ventana (el dashboard scrollea en window,
 * no en un contenedor interno). Solo se activa cuando el usuario arrastra hacia
 * abajo estando en el tope (scrollY <= 0). En desktop los listeners táctiles no
 * disparan, así que es inocuo. El estado mutable del gesto vive en refs para no
 * re-suscribir los listeners en cada frame.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  maxPull = 120,
  disabled = false,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const startY = useRef<number | null>(null)
  const pulling = useRef(false)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)
  // onRefresh puede ser una función inline (nueva referencia por render): la
  // guardamos en un ref para no re-suscribir los listeners. Se sincroniza en un
  // effect (no durante el render) — el ref solo se lee en handlers táctiles, que
  // ocurren después del commit.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (disabled || typeof window === "undefined") return

    const atTop = () => window.scrollY <= 0

    const setDistance = (d: number) => {
      distanceRef.current = d
      setPullDistance(d)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
      pulling.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current || startY.current === null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0 || !atTop()) {
        if (pulling.current) {
          pulling.current = false
          setDistance(0)
        }
        return
      }
      pulling.current = true
      // Resistencia: el pull se siente "pesado" y nunca pasa de maxPull.
      setDistance(Math.min(maxPull, dy * 0.5))
      // Evita el overscroll nativo / pull-to-refresh del navegador mientras tiramos.
      if (e.cancelable) e.preventDefault()
    }

    const onTouchEnd = () => {
      if (startY.current === null) return
      const triggered = pulling.current && distanceRef.current >= threshold
      startY.current = null
      pulling.current = false
      if (!triggered) {
        setDistance(0)
        return
      }
      refreshingRef.current = true
      setRefreshing(true)
      setDistance(threshold)
      Promise.resolve(onRefreshRef.current())
        .catch(() => {})
        .finally(() => {
          refreshingRef.current = false
          setRefreshing(false)
          setDistance(0)
        })
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    window.addEventListener("touchend", onTouchEnd, { passive: true })
    window.addEventListener("touchcancel", onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [disabled, threshold, maxPull])

  return { pullDistance, refreshing, threshold }
}
