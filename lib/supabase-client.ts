"use client"

import { createClient } from "@supabase/supabase-js"

// Anon Supabase client for client-side use (realtime, public storage).
// Uses the anon key which respects RLS.
let clientInstance: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (clientInstance) return clientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables")
  }

  clientInstance = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  })

  return clientInstance
}

// ─── Authenticated Realtime ──────────────────────────────────────────────────

/**
 * How long before token expiry to proactively refresh (5 minutes buffer).
 * The token TTL is 30 min; we refresh at 25 min to avoid any socket drop.
 */
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000

let refreshTimerId: ReturnType<typeof setTimeout> | null = null

/**
 * Fetches a short-lived Supabase JWT from /api/realtime/token and calls
 * supabase.realtime.setAuth(token) so the Realtime socket connects as
 * Postgres role `authenticated` (instead of `anon`).
 *
 * This allows org-scoped `authenticated` RLS policies (migration 202) to
 * govern which rows flow through the Realtime channel.
 *
 * Call this once before subscribing to any dashboard channel. The helper
 * schedules an automatic refresh before the 30-min token expiry so
 * channels stay authenticated across long sessions.
 *
 * @param options.onError  Optional callback for fetch/auth failures.
 *                         Defaults to console.error — the socket stays
 *                         connected on `anon` if refresh fails.
 */
export async function authenticateRealtime(options?: {
  onError?: (err: Error) => void
}): Promise<void> {
  const onError = options?.onError ?? ((err: Error) => console.error("[Realtime auth]", err))

  try {
    const res = await fetch("/api/realtime/token")
    if (!res.ok) {
      throw new Error(`/api/realtime/token responded ${res.status}`)
    }

    const { token, expiresAt } = (await res.json()) as {
      token: string
      expiresAt: string
    }

    const supabase = getSupabaseClient()
    await supabase.realtime.setAuth(token)

    // Schedule next refresh
    if (refreshTimerId !== null) {
      clearTimeout(refreshTimerId)
    }
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now()
    const refreshIn = Math.max(msUntilExpiry - REFRESH_BEFORE_EXPIRY_MS, 60_000)

    refreshTimerId = setTimeout(() => {
      authenticateRealtime({ onError }).catch(onError)
    }, refreshIn)
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}

/**
 * Cancel any pending token refresh timer.
 * Call this on component/hook teardown if the dashboard is fully unmounted.
 */
export function cancelRealtimeRefresh(): void {
  if (refreshTimerId !== null) {
    clearTimeout(refreshTimerId)
    refreshTimerId = null
  }
}
