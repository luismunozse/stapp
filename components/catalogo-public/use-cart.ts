"use client"

import { useEffect, useState, useCallback } from "react"
import { cartKey, cartSchema } from "@/lib/catalogo-validators"

export interface CartItem {
  id: string
  nombre: string
  precio: number
  cantidad: number
  imagen_url?: string | null
  stock_disponible: number | null
  varianteId?: string | null
  varianteEtiqueta?: string | null
}

const STORAGE_PREFIX = "stapp:catalogo-cart:"

function readCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Validar shape contra schema — defensa contra storage corrupto
    // (versiones viejas, manipulación manual, otros scripts).
    const result = cartSchema.safeParse(parsed)
    if (!result.success) {
      localStorage.removeItem(STORAGE_PREFIX + slug)
      return []
    }
    return result.data as CartItem[]
  } catch {
    return []
  }
}

function writeCart(slug: string, items: CartItem[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}

export function useCart(slug: string) {
  const [items, setItems] = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setItems(readCart(slug))
    setHydrated(true)
  }, [slug])

  useEffect(() => {
    if (hydrated) writeCart(slug, items)
  }, [slug, items, hydrated])

  const add = useCallback((item: Omit<CartItem, "cantidad">, cantidad = 1) => {
    setItems((prev) => {
      const k = cartKey(item)
      const existing = prev.find((i) => cartKey(i) === k)
      if (existing) {
        const max = item.stock_disponible ?? Infinity
        const nueva = Math.min(max, existing.cantidad + cantidad)
        return prev.map((i) => (cartKey(i) === k ? { ...i, cantidad: nueva } : i))
      }
      return [...prev, { ...item, cantidad }]
    })
  }, [])

  const remove = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => cartKey(i) !== key))
  }, [])

  const setCantidad = useCallback((key: string, cantidad: number) => {
    setItems((prev) => {
      if (cantidad <= 0) return prev.filter((i) => cartKey(i) !== key)
      return prev.map((i) => {
        if (cartKey(i) !== key) return i
        const max = i.stock_disponible ?? Infinity
        return { ...i, cantidad: Math.min(max, cantidad) }
      })
    })
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const count = items.reduce((s, i) => s + i.cantidad, 0)

  return { items, add, remove, setCantidad, clear, total, count, hydrated, cartKey }
}
