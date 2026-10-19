import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

const useSessionMock = vi.fn()
vi.mock("next-auth/react", () => ({ useSession: () => useSessionMock() }))

import { usePuedeCobrar } from "../use-puede-cobrar"

const asRole = (role: string | null) =>
  useSessionMock.mockReturnValue({ data: role ? { user: { role } } : null })

describe("usePuedeCobrar", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("ADMIN: true, no flag lookup", () => {
    asRole("ADMIN")
    const { result } = renderHook(() => usePuedeCobrar())
    expect(result.current).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("TECNICO: false, no flag lookup", () => {
    asRole("TECNICO")
    const { result } = renderHook(() => usePuedeCobrar())
    expect(result.current).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("VENDEDOR: false while unknown, true once the flag is on", async () => {
    asRole("VENDEDOR")
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ vendedoresManejanCaja: true }) })
    const { result } = renderHook(() => usePuedeCobrar())
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
  })

  it("VENDEDOR with the flag off: false", async () => {
    asRole("VENDEDOR")
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ vendedoresManejanCaja: false }) })
    const { result } = renderHook(() => usePuedeCobrar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it("VENDEDOR when the lookup fails (503): stays false, fail-closed", async () => {
    asRole("VENDEDOR")
    fetchMock.mockResolvedValue({ ok: false, json: async () => null })
    const { result } = renderHook(() => usePuedeCobrar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it("VENDEDOR when fetch rejects: false, no throw", async () => {
    asRole("VENDEDOR")
    fetchMock.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => usePuedeCobrar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })
})
