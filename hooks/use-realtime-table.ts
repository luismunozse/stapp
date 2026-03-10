"use client"

import { useEffect, useRef } from "react"
import { useSWRConfig } from "swr"
import { getSupabaseClient } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

/**
 * Hook genérico que subscribe a cambios en tiempo real de cualquier tabla.
 * Cuando detecta un INSERT, UPDATE o DELETE, revalida todas las
 * queries de SWR que matcheen con el patrón de la URL.
 *
 * @param table - Nombre de la tabla en Supabase
 * @param organizationId - ID de la organización para filtrar
 * @param swrKeyPattern - Patrón de la clave SWR a revalidar (ej: "/api/clientes")
 */
export function useRealtimeTable(
  table: string,
  organizationId: string | null | undefined,
  swrKeyPattern: string
) {
  const { mutate } = useSWRConfig()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!organizationId) return

    const supabase = getSupabaseClient()

    const channel = supabase
      .channel(`${table}-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
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
  }, [table, organizationId, swrKeyPattern, mutate])
}
