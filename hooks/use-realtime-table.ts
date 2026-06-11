"use client"

import { useSWRConfig } from "swr"
import { useVisibilityPolling } from "@/hooks/use-visibility-polling"

/**
 * Generic hook that revalidates SWR keys matching swrKeyPattern on a 15-second
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
 * The hook name and signature are preserved for call-site compatibility.
 *
 * @param table - Table name (retained in signature for compatibility; not used in polling)
 * @param organizationId - Organization ID — polling is disabled when falsy
 * @param swrKeyPattern - SWR key substring to revalidate (e.g. "/api/clientes")
 */
export function useRealtimeTable(
  _table: string,
  organizationId: string | null | undefined,
  swrKeyPattern: string
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
