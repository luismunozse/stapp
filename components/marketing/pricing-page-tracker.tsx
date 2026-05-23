"use client"

import { useEffect } from "react"
import { track } from "@/lib/analytics/track"

/**
 * Dispara `pricing_page_view` una vez al montarse en /precios.
 * Componente sin UI: solo efecto. Se monta como hijo de la página server.
 */
export function PricingPageTracker() {
  useEffect(() => {
    track("pricing_page_view")
  }, [])
  return null
}
