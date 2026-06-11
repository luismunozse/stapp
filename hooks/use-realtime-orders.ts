"use client"

import { useEffect, useRef } from "react"
import { useSWRConfig } from "swr"
import { getSupabaseClient, authenticateRealtime } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

/**
 * Hook que subscribe a cambios en tiempo real de ordenes_servicio.
 * Cuando detecta un INSERT, UPDATE o DELETE, revalida todas las
 * queries de SWR que matcheen con el patrón de la URL.
 *
 * The Realtime socket is authenticated as Postgres role `authenticated`
 * via a short-lived JWT (see /api/realtime/token) so org-scoped
 * authenticated policies (migration 202) apply to the channel.
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

    let cancelled = false
    const supabase = getSupabaseClient()

    // Authenticate first; subscribe only after auth resolves.
    // .finally() ensures we still subscribe even if auth fails (degrades to anon).
    authenticateRealtime().finally(() => {
      if (cancelled) return

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
    })

    return () => {
      cancelled = true
      // TODO(FIX5): cancelRealtimeRefresh() is a global module-level timer.
      // Calling it here would cancel token refresh for all other mounted
      // dashboard consumers. Safe to call only when the last consumer unmounts
      // (no shared ref-count mechanism exists yet).
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [organizationId, swrKeyPattern, mutate])
}
