// __tests__/components/use-debounced-value.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDebouncedValue } from "@/components/catalogo/use-debounced-value"

afterEach(() => vi.useRealTimers())

describe("useDebouncedValue", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300))
    expect(result.current).toBe("a")
  })
  it("updates only after the delay", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } })
    rerender({ v: "ab" })
    expect(result.current).toBe("a")
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe("a")
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe("ab")
  })
  it("resets the timer on rapid changes (only last value wins)", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } })
    rerender({ v: "ab" })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ v: "abc" })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe("a")
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe("abc")
  })
})
