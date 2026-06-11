"use client"

import { useSWRConfig } from "swr"
import { useVisibilityPolling } from "@/hooks/use-visibility-polling"

/**
 * Hook that revalidates SWR keys matching swrKeyPattern on a 15-second
 * visibility-aware interval (polls while the tab is visible, pauses on
 * hidden, fires a catch-up on visible).
 *
 * Previously used Supabase Realtime postgres_changes subscriptions with an
 * HS256-minted JWT (PR3 approach). That approach was abandoned because the
 * production Supabase project migrated to asymmetric JWT signing (ECC P-256);
 * HS256-minted tokens are rejected by Supabase Realtime with
 * "JwtSignatureError: Failed to validate JWT signature". Polling is the
 * correct alternative and matches the seguimiento page (PR2).
 *
 * The hook name is preserved for call-site compatibility.
 *
 * @param organizationId - Organization ID — polling is disabled when falsy
 * @param swrKeyPattern - SWR key substring to revalidate (e.g. "/api/ordenes")
 */
export function useRealtimeOrders(
  organizationId: string | null | undefined,
  swrKeyPattern: string = "/api/ordenes"
) {
  const { mutate } = useSWRConfig()

  useVisibilityPolling(
    () => {
      mutate(
        (key) => typeof key === "string" && key.includes(swrKeyPattern),
        undefined,
        { revalidate: true }
      )
    },
    15000,
    Boolean(organizationId)
  )
}
