"use client"

import { useEffect, useRef } from "react"
import { useSWRConfig } from "swr"
import { getSupabaseClient } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

/**
 * Hook que subscribe a cambios en tiempo real de ordenes_servicio.
 * Cuando detecta un INSERT, UPDATE o DELETE, revalida todas las
 * queries de SWR que matcheen con el patrón de la URL.
 *
 * @param organizationId - ID de la organización para filtrar
 * @param swrKeyPattern - Patrón de la clave SWR a revalidar (ej: "/api/ordenes")
 */
export function useRealtimeOrders(
  organizationId: string | null | undefined,
  swrKeyPattern: string = "/api/ordenes"
) {
  const { mutate } = useSWRConfig()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!organizationId) return

    const supabase = getSupabaseClient()

    // Crear canal con filtro por organización
    const channel = supabase
      .channel(`ordenes-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ordenes_servicio",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          // Revalidar todas las queries de SWR que contengan el patrón
          mutate(
            (key) => typeof key === "string" && key.includes(swrKeyPattern),
            undefined,
            { revalidate: true }
          )
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [organizationId, swrKeyPattern, mutate])
}
