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
 *    covers it. Pass `rootRef` so that document-level view stays scoped to the
 *    caller's own form: without it, typing in a nested form (the "Nuevo
 *    cliente" dialog) marks the parent dirty too.
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
 *  down to a minimal customer projection (see "WHAT MAY BE PERSISTED").
 *  v3: the customer form itself stopped persisting the record it edits --
 *  national id, tax id, email and address (lib/cliente-draft-projection.ts).
 *  Each bump is what retires the entries that still hold those values: they were
 *  written under a laxer rule and would otherwise sit in localStorage, readable,
 *  for the rest of their 7 days.
 *
 *  A bump is about the DATA the envelope carries, not about the envelope's own
 *  fields: `conflicted` was added afterwards without one because it is optional
 *  and additive -- an entry that predates it reads back as "no conflict", which
 *  is what it meant -- and no snapshot got any wider. Discarding everyone's
 *  drafts for that would cost the exact work this hook exists to protect. */
const DRAFT_SCHEMA_VERSION = 3
const DEFAULT_DEBOUNCE_MS = 1000
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * How long the hook waits for the session to hand over a user and an
 * organization before it reports itself ready ANYWAY, with no draft and no
 * persistence.
 *
 * `ready` is the signal call sites gate their own prefill on -- the order
 * opened from an agenda turno, the `?clienteId=` deep link -- so a `ready` that
 * never arrives is an intake screen that stays blank with nothing on it to
 * explain why. `status` covers the two cases that resolve (a failed session
 * fetch reports "unauthenticated", a user without `organizationId` reports
 * "authenticated" with nothing usable in it); this timeout covers the one that
 * does not, a session request left hanging on a flaky counter network.
 *
 * Losing draft persistence in that state is a fair price. Losing the screen the
 * operator receives equipment on is not.
 */
const SESSION_GRACE_MS = 3000

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

/** Anything a person edits a form through. Radix builds its controls out of
 *  divs with an ARIA role, so the roles matter as much as the tag names. */
const FORM_CONTROL_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "canvas",
  '[contenteditable="true"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="slider"]',
  '[role="textbox"]',
].join(",")

/** Radix renders selects/menus/dialogs into a portal at the end of <body>, so
 *  a control the user opened from the form is not inside the <form> element
 *  any more. These are the layers that still count as "in the form". */
const FLOATING_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  '[role="listbox"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(",")

/**
 * True when the event landed on something a person edits THIS form with. The
 * gate used to latch on ANY document event: one click on the sidebar, a
 * backdrop or a card marked the form dirty for the rest of its life, so every
 * prefill that resolved afterwards (the "recibido por" default, the turno
 * fetch, the checklist template) counted as a user edit and got persisted as a
 * draft of untouched defaults.
 *
 * `root` (see the `rootRef` option) is what keeps a NESTED form out of it:
 * ClienteSelector mounts ClienteForm -- its own <form>, inside a portalled
 * dialog -- within both OrdenForm and RecepcionForm, and typing in "Nuevo
 * cliente" used to flip the parent's dirty flag. A control that belongs to
 * some other form is somebody else's edit; a control with no form of its own
 * is a portalled layer, which `root` cannot see by containment and is
 * therefore traced back to `root` through the trigger that opened it (see
 * isLayerOpenedFrom).
 */
function isFormInteraction(target: EventTarget | null, root: Element | null): boolean {
  if (!(target instanceof Element)) return false
  const control = target.closest(FORM_CONTROL_SELECTOR)
  if (!control) return false
  const ownerForm = control.closest("form")
  if (ownerForm) return !root || root.contains(ownerForm)
  if (!control.closest(FLOATING_LAYER_SELECTOR)) return false
  return !root || isLayerOpenedFrom(control, root)
}

/**
 * True when the portalled layer holding `control` was opened by something
 * inside `root`.
 *
 * The floating-layer branch above exists because `root.contains()` cannot see a
 * Radix select/menu/popover: its content is portalled to the end of <body>, so
 * a control the user opened FROM this form is no longer inside the form. What
 * that branch must NOT accept is a surface that merely floats on top of this
 * form. Two of them are one click away on every intake screen: the close X that
 * DialogContent renders outside the nested <form> (components/ui/dialog.tsx)
 * and the button of a useModal alert (components/ui/alert-dialog-custom.tsx).
 * Neither belongs to any form, so both used to land here and latch the dirty
 * gate for the rest of the page's life -- dismissing "no se pudo cargar el
 * turno" was enough -- and every async default that resolved afterwards got
 * persisted as a draft of untouched values.
 *
 * The link Radix does leave in the DOM is `aria-controls`: the trigger points
 * at the id of the content it opened (`contentId` in @radix-ui/react-select and
 * @radix-ui/react-popover). Following it back into `root` is what tells "the
 * select this form opened" from "a dialog that happens to be on screen". A
 * layer nobody in `root` points at is somebody else's surface.
 */
function isLayerOpenedFrom(control: Element, root: Element): boolean {
  // Walk up from the control: whichever element Radix stamped with the content
  // id is an ancestor of what the user clicked, whether that is the popper
  // wrapper or the listbox/dialog inside it.
  for (let node: Element | null = control; node; node = node.parentElement) {
    if (!node.id) continue
    try {
      if (root.querySelector(`[aria-controls="${cssEscape(node.id)}"]`)) return true
    } catch {
      // This id cannot be expressed as a selector (a quote in it, and no
      // CSS.escape to neutralize it). It only rules out THIS node: `contentId`
      // is stamped on an ancestor of what the user clicked, so aborting the
      // walk here answered "nobody in root opened this layer" without ever
      // looking at the node that carries the answer -- and a genuine portalled
      // control of this form stopped marking it dirty, which stops every save
      // from that point on. Skip the node, keep climbing.
      continue
    }
  }
  return false
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value
}

interface DraftEnvelope<T> {
  version: number
  savedAt: number
  /** `updatedAt` of the edited record when the draft was written, in ms.
   *  Absent for new-record drafts (and for drafts written before this field
   *  existed, which fall back to a savedAt comparison). */
  recordUpdatedAt?: number | null
  /** Somebody else saved the record while this draft's form was already
   *  holding it. Lives in the envelope and not only in React state because the
   *  re-stamp that keeps the draft readable (see restampDraft) also erases the
   *  only other trace of the conflict: `recordUpdatedAt` now MATCHES the
   *  colleague's save, so the next open restores the draft as if nothing had
   *  happened. Absent means "no conflict" -- which is what every envelope
   *  written before this field existed meant too. */
  conflicted?: boolean
  data: T
}

/** What `readDraft` hands back: the caller's snapshot plus the conflict the
 *  envelope was carrying, which is what lets a reopened form warn again. */
interface StoredDraft<T> {
  data: T
  conflicted: boolean
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
  /** The form's own root element (its `<form>`). The interaction gate only
   *  counts controls that belong to it, so a nested form -- the "Nuevo
   *  cliente" dialog ClienteSelector renders inside the intake screens --
   *  cannot mark THIS form dirty. Controls with no form of their own
   *  (portalled Radix select/menu content) still count: they are the layers
   *  this form opened. Omitting it keeps the old, permissive behaviour. */
  rootRef?: { readonly current: HTMLElement | null }
  /** Shape check for a stored draft, run before it is handed back. The
   *  envelope carries a schema version, but that number is maintained by hand:
   *  a form whose state changes shape without a bump hands the call site a
   *  7-day-old draft of the previous shape, and the TypeError that follows
   *  happens inside an effect -- i.e. it blanks the whole screen. Returning
   *  false (or throwing) discards the draft and the form opens clean. */
  validate?: (data: unknown) => boolean
}

export interface UseFormDraftResult<T> {
  /** Draft found on mount (or when `enabled`/`recordId` changes), already
   *  version/age/freshness-validated. Null when there's nothing to restore.
   *  The caller decides how to apply it (setValue/reset) and when to dismiss it. */
  draft: T | null
  /** True once the initial localStorage read for the current key has run --
   *  and ALSO once it is settled that no key can be built at all, because the
   *  session resolved without a user/organization or never resolved within
   *  SESSION_GRACE_MS. `draft` is null in that second case and nothing is ever
   *  persisted, but call sites that gate their own prefill on this flag get to
   *  run: waiting forever on a session that is not coming leaves the intake
   *  screen blank with no error on it. */
  ready: boolean
  /** Removes the persisted draft, cancels any pending write, and stops saving
   *  until the form is modified again. Call on successful submit or explicit
   *  "Descartar" -- never automatically on logout/expiry. */
  clearDraft: () => void
  /** Reports a change that did not re-render the component -- i.e. a
   *  react-hook-form field subscription. Without it, a form that stopped
   *  re-rendering per keystroke would also stop scheduling saves. */
  notifyChange: () => void
  /** True while this form is holding work this hook is responsible for: the
   *  operator has already interacted with it, or a restored draft is still on
   *  screen. It is the same condition the key effect below branches on, exposed
   *  so a call site that re-prefills from the server (see the SWR-driven
   *  prefill in cliente-form.tsx) takes that decision from the same signal
   *  instead of a second, differently-computed one that can drift.
   *
   *  A function over refs and not a state value on purpose: it must answer for
   *  the CURRENT commit. State would be read one commit late by any effect that
   *  runs before this hook's own -- which is exactly when the answer matters. */
  hasUnsavedWork: () => boolean
  /** True when somebody else saved the record while this form was already
   *  holding unsaved work: typed edits, or a restored draft still on screen.
   *  Nothing is discarded -- the work stays in the form and on disk -- but the
   *  call site must say so, because submitting now replaces what the other
   *  person saved.
   *
   *  It rides in the stored envelope (`conflicted`) and not only in this state,
   *  so closing and reopening the form still warns: re-initializing is exactly
   *  where the warning used to disappear, over a draft the re-stamp had made
   *  look current. Cleared ONLY by `clearDraft` -- submit and "Descartar", the
   *  two ways the conflict actually gets settled -- and it goes with the entry
   *  they delete. Always false for new-record forms, which have no
   *  `recordUpdatedAt` to move. */
  recordChangedWhileEditing: boolean
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

/**
 * Reads the caller's snapshot and serializes it, or returns null if either
 * step fails.
 *
 * The READ is inside the try on purpose. `getValue()` is the caller's own code
 * (react-hook-form's `getValues()` plus whatever component state the form
 * projects), and the three places this runs from are the unmount cleanup, the
 * key effect and the `pagehide` handler: an exception there does not lose a
 * draft, it tears the whole tree down and leaves the screen blank. Every other
 * failure path in this hook is swallowed for the same reason -- a draft is
 * best-effort and must never break the form it is protecting.
 */
function safeSnapshot(read: () => unknown): string | null {
  try {
    const serialized = JSON.stringify(read())
    return typeof serialized === "string" ? serialized : null
  } catch {
    // Snapshot that throws / cyclic structure / non-serializable value.
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

function readDraft<T>(
  key: string,
  recordUpdatedAtMs: number | null,
  validate?: (data: unknown) => boolean
): StoredDraft<T> | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    const isValid =
      !!parsed &&
      parsed.version === DRAFT_SCHEMA_VERSION &&
      typeof parsed.savedAt === "number" &&
      Date.now() - parsed.savedAt <= MAX_AGE_MS &&
      !isStaleAgainstRecord(parsed, recordUpdatedAtMs) &&
      // Inside the try on purpose: a validator that throws on a shape it did
      // not expect means the same thing as one that returns false.
      (!validate || validate(parsed.data))
    if (!isValid) {
      window.localStorage.removeItem(key)
      return null
    }
    return { data: parsed.data, conflicted: parsed.conflicted === true }
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

/**
 * Re-stamps the stored entry against the record the operator actually has in
 * front of them and marks it conflicted, leaving its data untouched.
 *
 * Used when the record moved under a form that is already holding work this
 * hook is responsible for. Deleting the entry is not an option -- that work is
 * on screen -- but leaving the old token on it is the same loss through the
 * back door: the next open reads it, calls it stale and removes it. Whatever
 * happens here, either this operator's work or the colleague's save is going to
 * lose; the hook keeps the work and reports the conflict
 * (`recordChangedWhileEditing`) so the decision belongs to the person looking
 * at the screen instead of being taken silently.
 *
 * The `conflicted` mark is the other half of that, and it is why the re-stamp
 * cannot be the only thing written here. Moving the token is what keeps the
 * draft readable, but it also destroys the evidence: the entry now looks
 * exactly like one written against the colleague's own save. A form that is
 * closed and reopened before the operator decides -- the customer dialog does
 * it on every `open` toggle -- re-initializes from scratch, the React flag goes
 * back to false, and the draft restores with no warning anywhere. "Guardar"
 * then replaces the colleague's save silently, which is the loss the whole
 * freshness token exists to prevent.
 */
function restampDraft(key: string, recordUpdatedAtMs: number | null): void {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw) as DraftEnvelope<unknown>
    if (!parsed || typeof parsed.savedAt !== "number") return
    parsed.recordUpdatedAt = recordUpdatedAtMs
    parsed.conflicted = true
    window.localStorage.setItem(key, JSON.stringify(parsed))
  } catch {
    // Corrupt entry / storage disabled -- every write here is best-effort.
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
  rootRef,
  validate,
}: UseFormDraftOptions<T>): UseFormDraftResult<T> {
  const { data: session, status: sessionStatus } = useSession()
  const userId = session?.user?.id
  const organizationId = session?.user?.organizationId
  const recordUpdatedAtMs = toMillis(recordUpdatedAt)
  const sessionUsable = !!userId && !!organizationId
  /** La sesion contesto, y lo que contesto no alcanza para armar una key: el
   *  fetch fallo (queda "unauthenticated") o el usuario no tiene organizacion.
   *  No hay nada mas que esperar. */
  const sessionResolvedUnusable = !sessionUsable && sessionStatus !== "loading"

  const [draft, setDraft] = useState<T | null>(null)
  const [ready, setReady] = useState(false)
  const [recordChangedWhileEditing, setRecordChangedWhileEditing] = useState(false)
  /** El plazo de SESSION_GRACE_MS ya vencio sin una sesion utilizable. Ver la
   *  nota de la constante. */
  const [sessionGraceExpired, setSessionGraceExpired] = useState(false)

  const keyRef = useRef<string | null>(null)
  /** `recordUpdatedAt` the current key was last initialized (or re-stamped)
   *  against. It is what lets a same-key re-run tell "the record moved under
   *  us" from a re-run for any other reason, without depending on which of the
   *  effect's dependencies happens to be the volatile one today. */
  const keyRecordUpdatedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const getValueRef = useRef(getValue)
  const enabledRef = useRef(enabled)
  const debounceMsRef = useRef(debounceMs)
  const recordUpdatedAtRef = useRef(recordUpdatedAtMs)
  const rootRefRef = useRef(rootRef)
  const validateRef = useRef(validate)
  /** Serialized snapshot the form is compared against to decide "did the user
   *  change anything?". Re-captured while no interaction has happened yet. */
  const baselineRef = useRef<string | null>(null)
  /** The baseline above is PROVISIONAL: it was taken before the caller's own
   *  writes for this key had rendered, so it must keep being re-taken on every
   *  commit until the operator actually touches the form (see the effect that
   *  consumes it).
   *
   *  Set by clearDraft -- which every call site runs BEFORE resetting the form
   *  -- and by the key effect, which has the same problem one commit later: the
   *  prefill that fills the form for the record being opened lives in an effect
   *  declared AFTER this hook, so when the key effect reads the form it still
   *  holds the previous record's values. */
  const baselineStaleRef = useRef(false)
  const lastSavedRef = useRef<string | null>(null)
  const interactedRef = useRef(false)
  /** True while the entry on disk holds work that was handed back to this form
   *  (a draft was found on mount and has not been cleared since). It is what
   *  separates the two ways a form can "equal the baseline" -- see flush. */
  const restoredRef = useRef(false)
  /** Mirrors the `conflicted` mark of the entry on disk for the current key, so
   *  every envelope written from here keeps carrying it. Without this, the first
   *  keystroke after the conflict rewrites the whole envelope and drops the
   *  mark -- and the reopen goes back to restoring in silence. */
  const conflictedRef = useRef(false)

  // Keep the flush-time reads pointing at the latest committed render. This
  // effect has no dependency array on purpose: it must run after every commit.
  useEffect(() => {
    getValueRef.current = getValue
    enabledRef.current = enabled
    debounceMsRef.current = debounceMs
    recordUpdatedAtRef.current = recordUpdatedAtMs
    rootRefRef.current = rootRef
    validateRef.current = validate
  })

  // Housekeeping for entries no read can reach any more (see sweepStaleDrafts).
  useEffect(() => {
    if (typeof window === "undefined") return
    sweepStaleDrafts()
  }, [])

  // Plazo maximo de espera de la sesion (ver SESSION_GRACE_MS). Solo se arma
  // mientras falte algo: con la sesion resuelta el efecto corta antes de crear
  // el timer, asi que un formulario sano no paga ni un re-render por esto.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!enabled || sessionUsable) return
    const timer = setTimeout(() => setSessionGraceExpired(true), SESSION_GRACE_MS)
    return () => clearTimeout(timer)
  }, [enabled, sessionUsable])

  // One-shot user-interaction detector -- see the "dirty gate" note above.
  useEffect(() => {
    if (typeof document === "undefined") return
    const onInteraction = (event: Event) => {
      if (!isFormInteraction(event.target, rootRefRef.current?.current ?? null)) return
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

    const serialized = safeSnapshot(() => getValueRef.current())
    if (serialized === null) return

    if (!interactedRef.current) {
      // Nothing the user did explains this value yet (mount-time prefill,
      // async defaults, a draft that was just restored). Move the baseline
      // instead of persisting -- that is what keeps the restore notice
      // meaningful.
      baselineRef.current = serialized
      return
    }
    if (serialized === baselineRef.current && !restoredRef.current) {
      // Back to where the form started: typed, saved, then undone. Returning
      // early here used to leave the entry written mid-edit on disk, so the
      // next open restored an intermediate version the user had already
      // walked back. There is nothing worth keeping -- drop it.
      //
      // Only when the baseline is the form's own pristine state. A RESTORED
      // draft becomes the baseline too (it is the pre-interaction value, so the
      // branch above moves the reference onto it), and there "the form equals
      // the baseline" means "the form still equals the draft it restored" --
      // which is the one state that must never delete it. One click on
      // Siguiente, a select opened and closed, or any click inside a dialog was
      // enough to wipe the draft while the notice still announced it. Those
      // fall through to the write below instead, so an intermediate edit that
      // was walked back is overwritten by the restored value rather than left
      // on disk.
      //
      // And only what THIS instance wrote. Two tabs open on the same form share
      // the key: one that mounted before the other saved anything has an empty
      // storage behind it, so its own pristine state IS its baseline and it has
      // no restored draft to protect -- the first click that changes nothing
      // deleted the draft the other tab had just written. `lastSavedRef` is the
      // same distinction `restoredRef` already makes for the restore case: it is
      // non-null exactly when the entry on disk came from here.
      if (lastSavedRef.current !== null) {
        lastSavedRef.current = null
        try {
          window.localStorage.removeItem(key)
        } catch {
          // ignore
        }
      }
      return
    }
    if (serialized === lastSavedRef.current) return

    try {
      // Built by hand instead of re-serializing the whole snapshot: `serialized`
      // is already valid JSON and these forms are big enough that stringifying
      // them twice per write is worth avoiding.
      const envelope =
        `{"version":${DRAFT_SCHEMA_VERSION},` +
        `"savedAt":${Date.now()},` +
        `"recordUpdatedAt":${recordUpdatedAtRef.current ?? "null"},` +
        // Only written when it is true: an absent mark is what "no conflict"
        // has always meant on disk, so nothing has to be migrated.
        (conflictedRef.current ? `"conflicted":true,` : "") +
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
      // Sin key no se lee ni se graba nada, pero eso no puede dejar a los call
      // sites esperando para siempre: `ready` es lo que habilita el prefill de
      // un turno o de un ?clienteId=, y sin el la pantalla de alta queda en
      // blanco sin ningun error (ver SESSION_GRACE_MS). Con el dialog cerrado
      // (`enabled` en false) no hay nada que habilitar: ahi sigue en false.
      setReady(enabled && (sessionResolvedUnusable || sessionGraceExpired))
      return
    }
    const key = buildDraftKey(feature, organizationId, userId, recordId, scope)
    // Misma key, pero el efecto volvio a correr: tipicamente porque el
    // `updatedAt` del registro se movio (otro operador guardo la misma ficha y
    // SWR revalido). Re-inicializar aca, sobre un formulario que YA tiene
    // trabajo del que este hook se hizo cargo, es exactamente la perdida que
    // existe para evitar. Ese trabajo es de dos tipos y los dos cuentan:
    //
    //  - `interactedRef`: lo que el operador escribio. `readDraft` borra la
    //    entrada por desactualizada, la referencia de comparacion pasa a ser lo
    //    que hay escrito sin guardar y el flag de sucio se apaga, asi que el
    //    flush siguiente solo mueve la referencia y no vuelve a grabar hasta
    //    que se toque otro control. Un vencimiento de sesion en ese hueco se
    //    lleva todo lo escrito.
    //
    //  - `restoredRef`: un borrador que el call site ya aplico y sigue
    //    mostrando. Su propio latch de "borrador aplicado" ya esta puesto, asi
    //    que nunca va a volver a aplicar nada: la entrada se borraba, `draft`
    //    pasaba a null y el formulario se quedaba en pantalla con esos valores
    //    y con el aviso diciendo que se habia restaurado uno. "Guardar" pisaba
    //    entonces el guardado del companero con exactamente el contenido que el
    //    token de frescura existe para rechazar -- la misma perdida por otra
    //    puerta.
    //
    // Nada de eso se descarta: se conserva el trabajo, se re-estampa la entrada
    // contra el registro que el operador tiene delante (con el token viejo
    // sobrevive en disco pero la proxima apertura la descarta, que es la misma
    // perdida diferida) y se levanta `recordChangedWhileEditing` para que el
    // formulario lo AVISE. Guardar o descartar es una decision de quien esta
    // mirando la pantalla, no algo que se resuelva en silencio.
    if (key === keyRef.current && (interactedRef.current || restoredRef.current)) {
      if (recordUpdatedAtMs !== keyRecordUpdatedAtRef.current) {
        keyRecordUpdatedAtRef.current = recordUpdatedAtMs
        // El flag va en la ref ANTES que en el estado y ademas queda en el
        // sobre (restampDraft): el aviso tiene que sobrevivir a que se cierre y
        // se vuelva a abrir el formulario, y el estado de React no. Ver la nota
        // de restampDraft. La ref cubre ademas el caso en que todavia no hay
        // nada escrito en disco -- el debounce no llego a disparar -- para que
        // el flush siguiente ya salga marcado.
        conflictedRef.current = true
        restampDraft(key, recordUpdatedAtMs)
        setRecordChangedWhileEditing(true)
      }
      // Fuerza la reescritura del sobre completo en el flush siguiente, para lo
      // que el operador siga escribiendo a partir de ahora.
      lastSavedRef.current = null
      setReady(true)
      return
    }
    if (key !== keyRef.current) flushPending()
    keyRef.current = key
    keyRecordUpdatedAtRef.current = recordUpdatedAtMs
    interactedRef.current = false
    lastSavedRef.current = null
    // Provisional: lo que se lee ACA es el formulario del registro ANTERIOR. El
    // prefill de este (reset con los valores de la ficha que se acaba de abrir)
    // corre en un efecto declarado despues de este hook, o sea en el commit que
    // sigue. Dejar la referencia clavada aca hacia que el primer click dentro
    // de la ventana del debounce grabara un borrador de una ficha recien
    // precargada que nadie edito.
    baselineStaleRef.current = true
    baselineRef.current = safeSnapshot(() => getValueRef.current())
    const restored = readDraft<T>(key, recordUpdatedAtMs, validateRef.current)
    restoredRef.current = restored !== null
    // El conflicto se recupera del sobre, no se apaga. Re-inicializar es
    // justamente el camino por el que se perdia: el re-estampado deja la
    // entrada con el token del companero, asi que sin esta marca el borrador
    // vuelve a restaurarse como si nadie hubiera guardado nada en el medio.
    conflictedRef.current = restored?.conflicted ?? false
    setRecordChangedWhileEditing(conflictedRef.current)
    setDraft(restored ? restored.data : null)
    setReady(true)
  }, [
    feature,
    recordId,
    scope,
    enabled,
    userId,
    organizationId,
    recordUpdatedAtMs,
    flushPending,
    sessionResolvedUnusable,
    sessionGraceExpired,
  ])

  // Schedule a save after every commit. Cheap: `getValue()` only runs when the
  // timer actually fires, and an already-armed timer is left alone.
  useEffect(() => {
    // Whatever the caller wrote after arming the flag (the reset that follows
    // clearDraft, the prefill that follows a key re-initialisation) lands in a
    // LATER commit than the one that armed it, and there is no way to know
    // which: the reset after clearDraft arrives in the next commit, while the
    // prefill effect of a call site runs in the same effect flush as the key
    // effect -- i.e. after THIS effect has already run -- and only shows up one
    // commit further on. So the baseline is re-taken on every commit while the
    // flag is armed, and the flag is only disarmed by the operator touching the
    // form: from that point on the value IS a real edit and must not become the
    // baseline. Cheap while it lasts -- a form is only untouched for the handful
    // of commits its own mount-time prefills take.
    if (baselineStaleRef.current) {
      if (interactedRef.current) {
        baselineStaleRef.current = false
      } else {
        baselineRef.current = safeSnapshot(() => getValueRef.current())
      }
    }
    armSave()
  })

  // Write whatever is pending on the way out (navigation, session expiry).
  useEffect(() => {
    return () => {
      flushPending()
    }
  }, [flushPending])

  // React's cleanup does NOT run when the tab is closed, the process is killed
  // or iOS suspends the PWA -- the exact cases this hook exists for. These two
  // events are the ones browsers do fire, so they are what actually makes the
  // last debounce window survive.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onPageHide = () => flushPending()
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPending()
    }
    window.addEventListener("pagehide", onPageHide)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      document.removeEventListener("visibilitychange", onVisibilityChange)
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
    // Nothing restored is on disk any more, so "the form equals the baseline"
    // goes back to meaning "the user undid their own edits" (see flush).
    restoredRef.current = false
    // Submit and "Descartar" are the two ways the conflict gets settled: either
    // this operator's version won or they took the colleague's. Leaving the
    // warning up after that is the notice that trains people to ignore it. The
    // entry itself goes away below, so the mark on disk goes with it; the ref
    // is what keeps the NEXT draft written from this form -- work started after
    // the conflict was settled -- from inheriting it.
    conflictedRef.current = false
    setRecordChangedWhileEditing(false)
    // Every call site clears BEFORE resetting the form ("Descartar", submit),
    // so reading the form here captures the values that are about to be thrown
    // away. Taking that as the baseline meant the first click after a discard
    // saved a draft of the blank defaults and the next open announced a
    // restored draft with nothing in it. Provisional value now, re-taken on
    // the commit that carries the reset (see the effect above).
    baselineRef.current = safeSnapshot(() => getValueRef.current())
    baselineStaleRef.current = true
    setDraft(null)
    const key = keyRef.current
    if (typeof window === "undefined" || !key) return
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }, [])

  const hasUnsavedWork = useCallback(
    () => interactedRef.current || restoredRef.current,
    []
  )

  return {
    draft,
    ready,
    clearDraft,
    notifyChange: armSave,
    hasUnsavedWork,
    recordChangedWhileEditing,
  }
}
