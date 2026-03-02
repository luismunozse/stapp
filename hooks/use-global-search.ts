"use client"

import { useState, useCallback, useRef } from "react"

interface SearchResult {
  clientes: Array<{
    id: string
    nombre: string
    telefono: string
    email: string | null
    dni: string | null
  }>
  ordenes: Array<{
    id: string
    numero_orden: number
    dispositivo: string
    estado: string
    problema_reportado: string
    marca: string | null
    cliente_nombre: string | null
  }>
}

export function useGlobalSearch() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult>({ clientes: [], ordenes: [] })
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    setQuery(q)

    // Cancelar búsqueda anterior
    if (abortRef.current) {
      abortRef.current.abort()
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    if (!q || q.trim().length < 2) {
      setResults({ clientes: [], ordenes: [] })
      setLoading(false)
      return
    }

    setLoading(true)

    // Debounce de 300ms
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q.trim())}&type=all&limit=8`,
          { signal: controller.signal }
        )

        if (!res.ok) throw new Error("Search failed")

        const data = await res.json()
        setResults(data)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error("Search error:", err)
        setResults({ clientes: [], ordenes: [] })
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  const clear = useCallback(() => {
    setQuery("")
    setResults({ clientes: [], ordenes: [] })
    setLoading(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()
  }, [])

  const hasResults = results.clientes.length > 0 || results.ordenes.length > 0

  return { query, results, loading, hasResults, search, clear }
}
