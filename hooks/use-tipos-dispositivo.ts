"use client"

import { useState, useEffect, useCallback } from "react"
import type { TipoDispositivoCustom } from "@/types"

interface UseTiposDispositivoOptions {
  incluirTodos?: boolean
  soloActivos?: boolean
}

interface UseTiposDispositivoReturn {
  tipos: TipoDispositivoCustom[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useTiposDispositivo(
  options: UseTiposDispositivoOptions = {}
): UseTiposDispositivoReturn {
  const { incluirTodos = false, soloActivos = true } = options
  const [tipos, setTipos] = useState<TipoDispositivoCustom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTipos = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (incluirTodos) params.append("incluirTodos", "true")
      if (!soloActivos) params.append("soloActivos", "false")

      const res = await fetch(`/api/tipos-dispositivo?${params.toString()}`)

      if (!res.ok) {
        throw new Error("Error al cargar tipos de dispositivo")
      }

      const data = await res.json()
      setTipos(data)
    } catch (err) {
      console.error("Error fetching tipos dispositivo:", err)
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }, [incluirTodos, soloActivos])

  useEffect(() => {
    fetchTipos()
  }, [fetchTipos])

  return { tipos, loading, error, refetch: fetchTipos }
}
