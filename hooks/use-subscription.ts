"use client"

import { useState, useEffect, useCallback } from "react"

interface SubscriptionStatus {
  isPremium: boolean
  planTipo: "FREE" | "PREMIUM"
  planNombre: string
  features: string[]
}

interface UseSubscriptionReturn {
  isPremium: boolean
  planTipo: "FREE" | "PREMIUM"
  planNombre: string
  features: string[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Hook para verificar el estado de suscripción del usuario
 * Usado para mostrar/ocultar features Premium en el cliente
 */
export function useSubscription(): UseSubscriptionReturn {
  const [status, setStatus] = useState<SubscriptionStatus>({
    isPremium: false,
    planTipo: "FREE",
    planNombre: "Free",
    features: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch("/api/subscription/status")

      if (!response.ok) {
        throw new Error("Error al obtener estado de suscripción")
      }

      const data = await response.json()

      setStatus({
        isPremium: data.isPremium,
        planTipo: data.planTipo || "FREE",
        planNombre: data.planNombre || "Free",
        features: data.features || [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
      // En caso de error, asumir FREE por seguridad
      setStatus({
        isPremium: false,
        planTipo: "FREE",
        planNombre: "Free",
        features: [],
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  return {
    ...status,
    loading,
    error,
    refetch: fetchStatus,
  }
}

/**
 * Hook simplificado que solo retorna si es Premium
 * Útil cuando solo necesitas verificar acceso
 */
export function useIsPremium(): { isPremium: boolean; loading: boolean } {
  const { isPremium, loading } = useSubscription()
  return { isPremium, loading }
}
