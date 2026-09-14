/**
 * Tests: useEscapeKey vs. a nested dismissable layer.
 *
 * Radix registers its Escape handler on `document` with `{ capture: true }`,
 * so it runs BEFORE any bubble-phase listener. On dismiss it calls
 * `event.preventDefault()` but never `stopPropagation()` — see
 * `@radix-ui/react-dismissable-layer` — so the same keystroke still reaches us.
 *
 * Without a `defaultPrevented` guard, one Escape collapses two layers at once:
 * the dropdown the user meant to close, and the drawer or modal wrapping it.
 * That is the wrong mental model — Escape peels one layer.
 *
 * This surfaced when the branch switcher (a Radix popover) was mounted inside
 * the mobile drawer, which closes itself on Escape. It is the first such
 * nesting in the navbar, but the guard belongs in the hook: any dismissable
 * dropped inside any of its three consumers would hit the same thing.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

import { useEscapeKey } from "@/hooks/use-escape-key"

/** Stands in for Radix: capture phase, preventDefault, no stopPropagation. */
const installCaptureDismisser = () => {
  const handler = (event: KeyboardEvent) => {
    if (event.key === "Escape") event.preventDefault()
  }
  document.addEventListener("keydown", handler, { capture: true })
  return () => document.removeEventListener("keydown", handler, { capture: true })
}

const pressEscape = () => {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  )
}

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
})

describe("useEscapeKey", () => {
  it("closes its own layer when nothing else handled the key", () => {
    const close = vi.fn()
    renderHook(() => useEscapeKey(close, true))

    pressEscape()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it("stands down when a nested dismissable already consumed the Escape", () => {
    const close = vi.fn()
    renderHook(() => useEscapeKey(close, true))
    uninstall = installCaptureDismisser()

    pressEscape()

    // The dropdown closed. The drawer around it must stay open.
    expect(close).not.toHaveBeenCalled()
  })

  it("still ignores the key while disabled", () => {
    const close = vi.fn()
    renderHook(() => useEscapeKey(close, false))

    pressEscape()

    expect(close).not.toHaveBeenCalled()
  })

  it("resumes handling once the nested layer is gone", () => {
    const close = vi.fn()
    renderHook(() => useEscapeKey(close, true))

    uninstall = installCaptureDismisser()
    pressEscape()
    expect(close).not.toHaveBeenCalled()

    // Dropdown dismissed itself; the next Escape belongs to the drawer.
    uninstall()
    uninstall = null
    pressEscape()

    expect(close).toHaveBeenCalledTimes(1)
  })
})
