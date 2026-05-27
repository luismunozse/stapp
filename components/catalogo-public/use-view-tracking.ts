"use client"

import { useEffect } from "react"

/**
 * Trackea una vista de item del catálogo cuando el dialog/page se abre.
 * Fire & forget — no bloquea UI; errores se ignoran.
 *
 * Extraído de item-detail-dialog para que el componente principal no
 * dependa de fetch + endpoint específico.
 */
export function useViewTracking(slug: string, itemId: string | null, open: boolean) {
  useEffect(() => {
    if (!open || !itemId) return
    fetch(`/api/public/catalogo/${slug}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
      keepalive: true,
    }).catch(() => {})
  }, [open, itemId, slug])
}
