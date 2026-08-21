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
 * where `scope` is `edit:{recordId}` or `new`, optionally suffixed with the
 * caller's `scope` discriminator (`new:turno:{id}`) so two forms of the same
 * feature that were opened with a different origin never share a draft. Ids
 * come from the NextAuth session (never from caller-supplied strings) so a
 * key can't accidentally leak data across users/orgs sharing a device.
 *
 * The stored envelope carries its own schema version, a timestamp and -- for
 * edit-mode forms -- the record's `updatedAt` as it was when the draft was
 * written. A draft that fails to parse, was written by an older/newer schema,
 * is older than MAX_AGE_MS, or belongs to a record that someone else has
 * saved since, is treated as absent and removed. Persistence is best-effort
 * -- SSR-safe (window/localStorage guarded) and quota-safe (write failures
 * are swallowed, never surfaced to the form).
 *
 * WHAT MAY BE PERSISTED. These forms run on shared front-desk terminals and a
 * draft survives logout on purpose, for up to MAX_AGE_MS. Everything the
 * caller returns from `getValue()` is therefore readable in plaintext by the
 * next operator on that machine. Call sites must project their state down to
 * what the restored form actually consumes: no device unlock codes, no
 * customer record beyond the couple of fields the restored UI reads back.
 * Bump DRAFT_SCHEMA_VERSION whenever that shape changes -- the key carries the
 * version, and the mount sweep below deletes every entry written by an older
 * one, which is what retires drafts that were saved under a laxer rule.
 *
 * Two things this hook deliberately does NOT do naively:
 *
 * 1. Dirty gate. It persists only after a real user interaction AND only
 *    when the snapshot actually differs from the last pre-interaction one.
 *    Forms auto-populate on mount (session-derived defaults, deep-link
 *    prefill, templates that resolve late); persisting those wrote a draft
 *    of untouched defaults and greeted the user with "se restauró un
 *    borrador" on every single reopen, which trains people to ignore the
 *    notice that matters. Interaction is observed at the document level
 *    instead of asking every call site for a `dirty` flag: form state lives
 *    partly outside react-hook-form (checklists, accesorios, sector) and
 *    partly behind portalled Radix menus, so no single per-form signal
 *    covers it.
 *
 * 2. Debounce that cannot starve. The snapshot is read through `getValue()`
 *    at flush time and the timer is armed at most once per window -- never
 *    re-armed by a later change. A classic "reset the timer on every change"
 *    debounce never fires while someone types continuously, i.e. it loses
 *    exactly the data it exists to save. `getValue` (instead of a `value`
 *    prop) also keeps call sites from having to re-render the whole form on
 *    every keystroke just to feed this hook.
 */

/** v2: the persisted snapshots dropped the device access code and were cut
 *  down to a minimal customer projection (see "WHAT MAY BE PERSISTED"). The
 *  bump is what retires the v1 entries that still hold those values. */
const DRAFT_SCHEMA_VERSION = 2
const DEFAULT_DEBOUNCE_MS = 1000
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Events that count as "the user is working on this form". Capture phase on
 *  `document` so portalled UI (Radix selects/dialogs) counts too. */
const USER_INTERACTION_EVENTS = [
  "pointerdown",
  "mousedown",
  "click",
  "keydown",
  "input",
  "change",
  "paste",
] as const

interface DraftEnvelope<T> {
  version: number
  savedAt: number
  /** `updatedAt` of the edited record when the draft was written, in ms.
   *  Absent for new-record drafts (and for drafts written before this field
   *  existed, which fall back to a savedAt comparison). */
  recordUpdatedAt?: number | null
  data: T
}

export interface UseFormDraftOptions<T> {
  /** Stable feature id, e.g. "recepcion-form", "orden-form", "cliente-form". */
  feature: string
  /** Record id for edit-mode forms; omit/null for a "new record" form. */
  recordId?: string | null
  /** Extra discriminator appended to the scope segment of the key, for forms
   *  whose "new record" case is not interchangeable (e.g. an order started
   *  from a turno vs. a walk-in). */
  scope?: string | null
  /** Reads the current serializable snapshot of the form. Called at most once
   *  per debounce window, never during render, so it can read react-hook-form
   *  through `getValues()` without subscribing the component to every field. */
  getValue: () => T
  /** Whether persistence is active. Set to false to pause both loading and
   *  saving (e.g. a dialog form while it's closed). Defaults to true. */
  enabled?: boolean
  /** Debounce delay in ms before a changed value is written. Defaults to 1000. */
  debounceMs?: number
  /** `updatedAt` of the record being edited, as loaded from the server. When
   *  it is newer than the stored draft, the draft is discarded instead of
   *  silently overwriting somebody else's save. Ignored for new records. */
  recordUpdatedAt?: string | number | Date | null
}

export interface UseFormDraftResult<T> {
  /** Draft found on mount (or when `enabled`/`recordId` changes), already
   *  version/age/freshness-validated. Null when there's nothing to restore.
   *  The caller decides how to apply it (setValue/reset) and when to dismiss it. */
  draft: T | null
  /** True once the initial localStorage read for the current key has run. */
  ready: boolean
  /** Removes the persisted draft, cancels any pending write, and stops saving
   *  until the form is modified again. Call on successful submit or explicit
   *  "Descartar" -- never automatically on logout/expiry. */
  clearDraft: () => void
  /** Reports a change that did not re-render the component -- i.e. a
   *  react-hook-form field subscription. Without it, a form that stopped
   *  re-rendering per keystroke would also stop scheduling saves. */
  notifyChange: () => void
}

function buildDraftKey(
  feature: string,
  organizationId: string,
  userId: string,
  recordId?: string | null,
  scope?: string | null
): string {
  const base = recordId ? `edit:${recordId}` : "new"
  const suffix = scope ? `:${scope}` : ""
  return `draft:v${DRAFT_SCHEMA_VERSION}:${feature}:${organizationId}:${userId}:${base}${suffix}`
}

function toMillis(value?: string | number | Date | null): number | null {
  if (value === null || value === undefined) return null
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function safeStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === "string" ? serialized : null
  } catch {
    // Cyclic structure / non-serializable value -- a draft is best-effort.
    return null
  }
}

/**
 * True when the record was saved by somebody else after this draft was
 * written. Preferred check is the token captured at write time (exact: any
 * change to the record invalidates the draft); the savedAt comparison is the
 * fallback for envelopes written before the token existed.
 */
function isStaleAgainstRecord<T>(
  envelope: DraftEnvelope<T>,
  recordUpdatedAtMs: number | null
): boolean {
  if (recordUpdatedAtMs === null) return false
  if (typeof envelope.recordUpdatedAt === "number") {
    return recordUpdatedAtMs !== envelope.recordUpdatedAt
  }
  return recordUpdatedAtMs > envelope.savedAt
}

/** Throttles the sweep below: every mounted form would otherwise walk the
 *  whole of localStorage again. Not a one-shot flag because a front-desk PWA
 *  can stay open for days, which is long enough for drafts to expire while the
 *  page never reloads. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let lastSweepAt = 0

/**
 * Deletes every `draft:` entry that no read will ever reach again: those
 * written by another schema version (the version is part of the key, so
 * bumping it orphans them) and those past MAX_AGE_MS. Without this, expired
 * and orphaned drafts -- the ones most likely to hold data written under an
 * older, laxer persistence rule -- pile up until a `setItem` hits the quota,
 * at which point every save fails silently and the feature quietly stops
 * working. Runs on mount because that is the only moment guaranteed to happen
 * on a shared terminal that never reloads.
 */
function sweepStaleDrafts(): void {
  if (Date.now() - lastSweepAt < SWEEP_INTERVAL_MS) return
  lastSweepAt = Date.now()
  try {
    const currentPrefix = `draft:v${DRAFT_SCHEMA_VERSION}:`
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith("draft:")) continue
      if (!key.startsWith(currentPrefix)) {
        doomed.push(key)
        continue
      }
      let expired = true
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "") as DraftEnvelope<unknown>
        expired =
          !parsed ||
          typeof parsed.savedAt !== "number" ||
          Date.now() - parsed.savedAt > MAX_AGE_MS
      } catch {
        expired = true // unparseable: nothing can restore it either
      }
      if (expired) doomed.push(key)
    }
    for (const key of doomed) window.localStorage.removeItem(key)
  } catch {
    // Storage disabled/full: housekeeping is best-effort by definition.
  }
}

function readDraft<T>(key: string, recordUpdatedAtMs: number | null): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    const isValid =
      !!parsed &&
      parsed.version === DRAFT_SCHEMA_VERSION &&
      typeof parsed.savedAt === "number" &&
      Date.now() - parsed.savedAt <= MAX_AGE_MS &&
      !isStaleAgainstRecord(parsed, recordUpdatedAtMs)
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
  scope = null,
  getValue,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  recordUpdatedAt = null,
}: UseFormDraftOptions<T>): UseFormDraftResult<T> {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const organizationId = session?.user?.organizationId
  const recordUpdatedAtMs = toMillis(recordUpdatedAt)

  const [draft, setDraft] = useState<T | null>(null)
  const [ready, setReady] = useState(false)

  const keyRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const getValueRef = useRef(getValue)
  const enabledRef = useRef(enabled)
  const debounceMsRef = useRef(debounceMs)
  const recordUpdatedAtRef = useRef(recordUpdatedAtMs)
  /** Serialized snapshot the form is compared against to decide "did the user
   *  change anything?". Re-captured while no interaction has happened yet. */
  const baselineRef = useRef<string | null>(null)
  const lastSavedRef = useRef<string | null>(null)
  const interactedRef = useRef(false)

  // Keep the flush-time reads pointing at the latest committed render. This
  // effect has no dependency array on purpose: it must run after every commit.
  useEffect(() => {
    getValueRef.current = getValue
    enabledRef.current = enabled
    debounceMsRef.current = debounceMs
    recordUpdatedAtRef.current = recordUpdatedAtMs
  })

  // Housekeeping for entries no read can reach any more (see sweepStaleDrafts).
  useEffect(() => {
    if (typeof window === "undefined") return
    sweepStaleDrafts()
  }, [])

  // One-shot user-interaction detector -- see the "dirty gate" note above.
  useEffect(() => {
    if (typeof document === "undefined") return
    const onInteraction = () => {
      interactedRef.current = true
    }
    for (const type of USER_INTERACTION_EVENTS) {
      document.addEventListener(type, onInteraction, { capture: true, passive: true })
    }
    return () => {
      for (const type of USER_INTERACTION_EVENTS) {
        document.removeEventListener(type, onInteraction, true)
      }
    }
  }, [])

  const flush = useCallback(() => {
    timerRef.current = null
    const key = keyRef.current
    if (typeof window === "undefined" || !key) return

    const serialized = safeStringify(getValueRef.current())
    if (serialized === null) return

    if (!interactedRef.current) {
      // Nothing the user did explains this value yet (mount-time prefill,
      // async defaults, a draft that was just restored). Move the baseline
      // instead of persisting -- that is what keeps the restore notice
      // meaningful.
      baselineRef.current = serialized
      return
    }
    if (serialized === baselineRef.current || serialized === lastSavedRef.current) return

    try {
      // Built by hand instead of re-serializing the whole snapshot: `serialized`
      // is already valid JSON and these forms are big enough that stringifying
      // them twice per write is worth avoiding.
      const envelope =
        `{"version":${DRAFT_SCHEMA_VERSION},` +
        `"savedAt":${Date.now()},` +
        `"recordUpdatedAt":${recordUpdatedAtRef.current ?? "null"},` +
        `"data":${serialized}}`
      window.localStorage.setItem(key, envelope)
      lastSavedRef.current = serialized
    } catch {
      // Quota exceeded / storage disabled -- a draft is best-effort, it must
      // never break the form.
    }
  }, [])

  /** Schedules a write. Never postpones an already-scheduled one: that is the
   *  starvation bug this hook had to grow out of. */
  const armSave = useCallback(() => {
    if (typeof window === "undefined") return
    if (!enabledRef.current || !keyRef.current) return
    if (timerRef.current) return
    timerRef.current = setTimeout(flush, debounceMsRef.current)
  }, [flush])

  const flushPending = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
    flush()
  }, [flush])

  // Resolve the storage key for the current feature/record/user/org and load
  // whatever draft (if any) is already there. Runs again if the session ids
  // resolve later (session loads async) or the record/scope/enabled flag changes.
  useEffect(() => {
    if (typeof window === "undefined" || !enabled || !userId || !organizationId) {
      // Pausing (dialog closed, session gone) must not drop a write that was
      // already scheduled under the previous key -- surviving the unmount is
      // the point of this hook.
      flushPending()
      keyRef.current = null
      setReady(false)
      return
    }
    const key = buildDraftKey(feature, organizationId, userId, recordId, scope)
    if (key !== keyRef.current) flushPending()
    keyRef.current = key
    interactedRef.current = false
    lastSavedRef.current = null
    baselineRef.current = safeStringify(getValueRef.current())
    setDraft(readDraft<T>(key, recordUpdatedAtMs))
    setReady(true)
  }, [feature, recordId, scope, enabled, userId, organizationId, recordUpdatedAtMs, flushPending])

  // Schedule a save after every commit. Cheap: `getValue()` only runs when the
  // timer actually fires, and an already-armed timer is left alone.
  useEffect(() => {
    armSave()
  })

  // Write whatever is pending on the way out (navigation, session expiry).
  useEffect(() => {
    return () => {
      flushPending()
    }
  }, [flushPending])

  const clearDraft = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // After an explicit clear the form usually stays mounted (success modal),
    // and every later re-render would otherwise re-persist the record that was
    // just submitted -- a duplicate-submission trap on the next open. Re-arm
    // the dirty gate: saving resumes only once the form is modified again.
    interactedRef.current = false
    lastSavedRef.current = null
    baselineRef.current = safeStringify(getValueRef.current())
    setDraft(null)
    const key = keyRef.current
    if (typeof window === "undefined" || !key) return
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }, [])

  return { draft, ready, clearDraft, notifyChange: armSave }
}
