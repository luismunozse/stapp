"use client"

import { useEffect, useRef } from "react"
import { useSWRConfig } from "swr"
import { getSupabaseClient, authenticateRealtime } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

/**
 * Hook genérico que subscribe a cambios en tiempo real de cualquier tabla.
 * Cuando detecta un INSERT, UPDATE o DELETE, revalida todas las
 * queries de SWR que matcheen con el patrón de la URL.
 *
 * The Realtime socket is authenticated as Postgres role `authenticated`
 * via a short-lived JWT (see /api/realtime/token) so org-scoped
 * authenticated policies (migration 202) apply to the channel.
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

    let cancelled = false
    const supabase = getSupabaseClient()

    // Authenticate first; subscribe only after auth resolves.
    // .finally() ensures we still subscribe even if auth fails (degrades to anon).
    authenticateRealtime().finally(() => {
      if (cancelled) return

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
  }, [table, organizationId, swrKeyPattern, mutate])
}
