// __tests__/hooks/use-moneda.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { SWRConfig } from "swr"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)

const CONFIG = { monedaLocal: "ARS", monedaExtranjera: "USD", fuentesDisponibles: ["MANUAL", "OFICIAL", "BLUE", "MEP"], fuente: "BLUE" }
const TC = { disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: "2026-11-12T10:00:00.000Z", estado: "vivo" }

function route(habilitada: boolean) {
  mockFetch.mockImplementation(async (url: string) =>
    url === "/api/configuracion/moneda"
      ? respond({ config: { ...CONFIG, habilitada }, itemsEnDivisa: { inventario: 2, servicios: 1 } })
      : respond(TC),
  )
}

describe("useMoneda", () => {
  beforeEach(() => vi.clearAllMocks())

  it("combines the config and the exchange rate", async () => {
    route(true)
    const { useMoneda } = await import("@/hooks/use-moneda")
    const { result } = renderHook(() => useMoneda(), { wrapper })

    await waitFor(() => expect(result.current.tipoCambio).toEqual(TC))
    expect(result.current.config?.monedaExtranjera).toBe("USD")
    expect(result.current.itemsEnDivisa).toEqual({ inventario: 2, servicios: 1 })
    expect(result.current.isLoading).toBe(false)
  })

  it("does not ask for the rate while the feature is off", async () => {
    route(false)
    const { useMoneda } = await import("@/hooks/use-moneda")
    const { result } = renderHook(() => useMoneda(), { wrapper })

    await waitFor(() => expect(result.current.config).toBeDefined())
    expect(result.current.tipoCambio).toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalledWith("/api/moneda/tipo-cambio", expect.anything())
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual(["/api/configuracion/moneda"])
  })
})
