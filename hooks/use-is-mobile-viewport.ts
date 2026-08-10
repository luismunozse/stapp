"use client"

import { useState, useEffect } from "react"

/**
 * Detecta si el viewport actual esta por debajo del breakpoint `sm` de
 * Tailwind (640px). Mismo patron que useIsTouchDevice en
 * components/ui/date-picker.tsx: arranca en false (server-safe, sin
 * mismatch de hidratacion) y se corrige en el primer efecto, a costa de un
 * reflow chico la primera vez que se monta en un celular real.
 *
 * Extraido de components/ordenes/recepcion-form.tsx (donde decide si se
 * muestra el boton "Agregar otro equipo" inline o en la barra sticky, y el
 * contador de equipos) porque components/ordenes/codigo-acceso-modal.tsx
 * tambien lo necesita, para no autofocar un input en mobile: con la hoja
 * anclada al fondo y sin manejo de teclado/visualViewport en el proyecto, un
 * input autofocado puede quedar tapado por el teclado en Android/PWA.
 *
 * En los tests, window.matchMedia esta stubeado en vitest.setup.ts con
 * `matches: false` por default, asi que sin un mock explicito el layout de
 * desktop es el que corre.
 */
export function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(max-width: 639.98px)")
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return isMobile
}
