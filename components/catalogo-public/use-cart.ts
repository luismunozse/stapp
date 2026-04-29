"use client"

import { useEffect, useState, useCallback } from "react"

export interface CartItem {
  id: string
  nombre: string
  precio: number
  cantidad: number
  imagen_url?: string | null
  stock_disponible: number | null
}

const STORAGE_PREFIX = "stapp:catalogo-cart:"

function readCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug)
    if (!raw) return []
    return JSON.parse(raw)
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
      const existing = prev.find((i) => i.id === item.id)
      if (existing) {
        const max = item.stock_disponible ?? Infinity
        const nueva = Math.min(max, existing.cantidad + cantidad)
        return prev.map((i) => (i.id === item.id ? { ...i, cantidad: nueva } : i))
      }
      return [...prev, { ...item, cantidad }]
    })
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const setCantidad = useCallback((id: string, cantidad: number) => {
    setItems((prev) => {
      if (cantidad <= 0) return prev.filter((i) => i.id !== id)
      return prev.map((i) => {
        if (i.id !== id) return i
        const max = i.stock_disponible ?? Infinity
        return { ...i, cantidad: Math.min(max, cantidad) }
      })
    })
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const count = items.reduce((s, i) => s + i.cantidad, 0)

  return { items, add, remove, setCantidad, clear, total, count, hydrated }
}
