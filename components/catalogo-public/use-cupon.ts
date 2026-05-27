"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

export interface CuponAplicado {
  codigo: string
  descuento: number
}

/**
 * Hook que encapsula validación de cupón contra el endpoint público.
 * Mantiene estado: input, aplicado, error, loading.
 *
 * Extraído de cart-drawer.tsx (era ~50 LOC inline). Permite reusarlo desde
 * cualquier otro flow que aplique cupones (kiosco, app móvil) sin duplicar
 * el fetch + manejo de errores.
 */
export function useCupon(slug: string, getSubtotal: () => number) {
  const [input, setInput] = useState("")
  const [aplicado, setAplicado] = useState<CuponAplicado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)

  const aplicar = useCallback(async () => {
    const codigo = input.trim().toUpperCase()
    if (!codigo) return
    setValidating(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/catalogo/${slug}/cupon/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, subtotal: getSubtotal() }),
      })
      if (!res.ok && res.status !== 400) {
        setError("Error al validar cupón")
        setAplicado(null)
        return
      }
      const data = await res.json().catch(() => ({ ok: false, error: "Respuesta inválida" }))
      if (!data.ok) {
        setError(data.error || "Cupón inválido")
        setAplicado(null)
        return
      }
      setAplicado({
        codigo: data.codigo,
        descuento: Number(data.descuento_aplicado) || 0,
      })
      toast.success(`Cupón ${data.codigo} aplicado`)
    } catch {
      setError("Error al validar cupón")
    } finally {
      setValidating(false)
    }
  }, [slug, input, getSubtotal])

  const quitar = useCallback(() => {
    setAplicado(null)
    setInput("")
    setError(null)
  }, [])

  return { input, setInput, aplicado, error, validating, aplicar, quitar }
}
