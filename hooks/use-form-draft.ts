"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"

/**
 * useFormDraft
 *
 * Debounced localStorage draft persistence for data-entry forms, so unsaved
 * input survives an unmount for ANY reason: session-expiry redirect,
 * accidental navigation, PWA process death, or a crash. Wired manually into
 * a form's `onSubmit`/discard flow -- this hook never talks to the network
 * and never clears itself on logout/expiry, since surviving expiry is the
 * whole point.
 *
 * Key scheme: `draft:v{SCHEMA_VERSION}:{feature}:{organizationId}:{userId}:{scope}`
 * where `scope` is `edit:{recordId}` or `new`. Ids come from the NextAuth
 * session (never from caller-supplied strings) so a key can't accidentally
 * leak data across users/orgs sharing a device. `feature` + `recordId` are
 * used instead of a raw caller-built key (a deliberate deviation from a
 * literal `{ key, ... }` API) so every call site gets a correctly namespaced
 * key for free instead of re-deriving the session ids itself.
 *
 * The stored envelope carries its own schema version and a timestamp: a
 * draft that fails to parse, was written by an older/newer schema, or is
 * older than MAX_AGE_MS is treated as absent and removed. Persistence is
 * best-effort -- SSR-safe (window/localStorage guarded) and quota-safe
 * (write failures are swallowed, never surfaced to the form).
 */

const DRAFT_SCHEMA_VERSION = 1
const DEFAULT_DEBOUNCE_MS = 1000
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface DraftEnvelope<T> {
  version: number
  savedAt: number
  data: T
}

export interface UseFormDraftOptions<T> {
  /** Stable feature id, e.g. "recepcion-form", "orden-form", "cliente-form". */
  feature: string
  /** Record id for edit-mode forms; omit/null for a "new record" form. */
  recordId?: string | null
  /** Current serializable snapshot of the form. Debounced-written to storage. */
  value: T
  /** Whether persistence is active. Set to false to pause both loading and
   *  saving (e.g. a dialog form while it's closed). Defaults to true. */
  enabled?: boolean
  /** Debounce delay in ms before a changed value is written. Defaults to 1000. */
  debounceMs?: number
}

export interface UseFormDraftResult<T> {
  /** Draft found on mount (or when `enabled`/`recordId` changes), already
   *  version/age-validated. Null when there's nothing to restore. The
   *  caller decides how to apply it (setValue/reset) and when to dismiss it. */
  draft: T | null
  /** True once the initial localStorage read for the current key has run. */
  ready: boolean
  /** Removes the persisted draft. Call on successful submit or explicit
   *  "Descartar" -- never automatically on logout/expiry. */
  clearDraft: () => void
}

function buildDraftKey(
  feature: string,
  organizationId: string,
  userId: string,
  recordId?: string | null
): string {
  const scope = recordId ? `edit:${recordId}` : "new"
  return `draft:v${DRAFT_SCHEMA_VERSION}:${feature}:${organizationId}:${userId}:${scope}`
}

function readDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    const isValid =
      !!parsed &&
      parsed.version === DRAFT_SCHEMA_VERSION &&
      typeof parsed.savedAt === "number" &&
      Date.now() - parsed.savedAt <= MAX_AGE_MS
    if (!isValid) {
      window.localStorage.removeItem(key)
      return null
    }
    return parsed.data
  } catch {
    // Corrupt draft (bad JSON, storage disabled, etc.) -- never let a
    // draft-restore failure break the form. Best-effort cleanup.
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
    return null
  }
}

export function useFormDraft<T>({
  feature,
  recordId = null,
  value,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseFormDraftOptions<T>): UseFormDraftResult<T> {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const organizationId = session?.user?.organizationId

  const [draft, setDraft] = useState<T | null>(null)
  const [ready, setReady] = useState(false)
  const keyRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolve the storage key for the current feature/record/user/org and load
  // whatever draft (if any) is already there. Runs again if the session ids
  // resolve later (session loads async) or the record/enabled flag changes.
  useEffect(() => {
    if (typeof window === "undefined" || !enabled || !userId || !organizationId) {
      keyRef.current = null
      setReady(false)
      return
    }
    const key = buildDraftKey(feature, organizationId, userId, recordId)
    keyRef.current = key
    setDraft(readDraft<T>(key))
    setReady(true)
  }, [feature, recordId, enabled, userId, organizationId])

  // Debounced save whenever `value` changes while enabled and a key is known.
  useEffect(() => {
    if (typeof window === "undefined" || !enabled || !keyRef.current) return
    const key = keyRef.current
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        const envelope: DraftEnvelope<T> = {
          version: DRAFT_SCHEMA_VERSION,
          savedAt: Date.now(),
          data: value,
        }
        window.localStorage.setItem(key, JSON.stringify(envelope))
      } catch {
        // Quota exceeded / serialization failure -- a draft is best-effort,
        // it must never break the form.
      }
    }, debounceMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // `ready` is intentionally included: it flips true right after the load
    // effect resolves `keyRef.current`, guaranteeing a save effect run (with
    // the now-known key) even when `value`'s identity hasn't changed since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, debounceMs, ready])

  const clearDraft = useCallback(() => {
    setDraft(null)
    if (typeof window === "undefined" || !keyRef.current) return
    try {
      window.localStorage.removeItem(keyRef.current)
    } catch {
      // ignore
    }
  }, [])

  return { draft, ready, clearDraft }
}
