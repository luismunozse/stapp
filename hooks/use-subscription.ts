"use client"

import { useState, useEffect, useCallback } from "react"

interface SubscriptionStatus {
  isPremium: boolean
  planTipo: "FREE" | "PREMIUM"
  planNombre: string
  planSlug: string
  tierOrder: number
  features: string[]
  featureFlags: Record<string, boolean>
}

interface UseSubscriptionReturn extends SubscriptionStatus {
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
    planSlug: "free",
    tierOrder: 0,
    features: [],
    featureFlags: {},
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
        planSlug: data.planSlug || "free",
        tierOrder: data.tierOrder || 0,
        features: data.features || [],
        featureFlags: data.featureFlags || {},
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
      // En caso de error, asumir FREE por seguridad
      setStatus({
        isPremium: false,
        planTipo: "FREE",
        planNombre: "Free",
        planSlug: "free",
        tierOrder: 0,
        features: [],
        featureFlags: {},
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

/**
 * Hook para chequear si el plan actual tiene una feature específica.
 * Usado para feature gating granular en el cliente (esconder/bloquear UI).
 */
export function useHasFeature(featureKey: string): {
  hasFeature: boolean
  loading: boolean
} {
  const { featureFlags, loading } = useSubscription()
  return {
    hasFeature: featureFlags?.[featureKey] === true,
    loading,
  }
}
