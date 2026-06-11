import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVisibilityPolling } from '../use-visibility-polling'

// jsdom default: document.visibilityState === 'visible'

describe('useVisibilityPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Reset visibility to visible before each test
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Helper: simulate visibility change
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('fires callback on each interval when enabled', () => {
    const callback = vi.fn()
    renderHook(() => useVisibilityPolling(callback, 1000, true))

    expect(callback).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(2)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('does not fire when enabled is false', () => {
    const callback = vi.fn()
    renderHook(() => useVisibilityPolling(callback, 1000, false))

    act(() => { vi.advanceTimersByTime(5000) })
    expect(callback).not.toHaveBeenCalled()
  })

  it('pauses polling when document becomes hidden', () => {
    const callback = vi.fn()
    renderHook(() => useVisibilityPolling(callback, 1000, true))

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(1)

    // Hide tab
    act(() => { setVisibility('hidden') })

    // Advance time — should NOT fire while hidden
    act(() => { vi.advanceTimersByTime(3000) })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('fires immediately on tab becoming visible again and resumes interval', () => {
    const callback = vi.fn()
    renderHook(() => useVisibilityPolling(callback, 1000, true))

    // Hide tab
    act(() => { setVisibility('hidden') })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(callback).not.toHaveBeenCalled()

    // Show tab — should fire once immediately (catch-up)
    act(() => { setVisibility('visible') })
    expect(callback).toHaveBeenCalledTimes(1)

    // Then resume interval
    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(2)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('cleans up interval and listener on unmount — no fire after unmount', () => {
    const callback = vi.fn()
    const { unmount } = renderHook(() => useVisibilityPolling(callback, 1000, true))

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(1)

    unmount()

    // Should not fire after unmount
    act(() => { vi.advanceTimersByTime(3000) })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cleans up when enabled flips to false', () => {
    const callback = vi.fn()
    let enabled = true
    const { rerender } = renderHook(() => useVisibilityPolling(callback, 1000, enabled))

    act(() => { vi.advanceTimersByTime(1000) })
    expect(callback).toHaveBeenCalledTimes(1)

    // Disable
    enabled = false
    rerender()

    act(() => { vi.advanceTimersByTime(3000) })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('uses the latest callback identity without resetting the interval', () => {
    let counter = 0
    const cb1 = vi.fn(() => { counter++ })
    const cb2 = vi.fn(() => { counter += 10 })

    let currentCb = cb1
    const { rerender } = renderHook(() => useVisibilityPolling(currentCb, 1000, true))

    // Switch callback identity before first tick
    currentCb = cb2
    rerender()

    act(() => { vi.advanceTimersByTime(1000) })
    // Should have used cb2 (the latest)
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(counter).toBe(10)
  })
})
