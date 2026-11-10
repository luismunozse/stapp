import { describe, it, expect } from "vitest"
import { hasActiveFilters, clienteBalanceChip, EMPTY_FILTERS } from "@/lib/clientes-list-state"

describe("hasActiveFilters", () => {
  it("is false for the empty state", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })

  it("ignores whitespace-only search", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: "   " })).toBe(false)
  })

  it.each([
    ["search", { search: "juan" }],
    ["tipoCliente", { tipoCliente: "EMPRESA" }],
    ["conDeuda", { conDeuda: true }],
    ["aceptaWhatsapp", { aceptaWhatsapp: "false" }],
    ["fechaDesde", { fechaDesde: "2026-01-01" }],
    ["fechaHasta", { fechaHasta: "2026-02-01" }],
  ])("is true when %s is set", (_name, patch) => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, ...patch })).toBe(true)
  })
})

describe("clienteBalanceChip", () => {
  it("returns null with no debt and no credit", () => {
    expect(clienteBalanceChip({})).toBeNull()
    expect(clienteBalanceChip({ deudaPendiente: 0, saldoCuenta: 0 })).toBeNull()
  })

  it("returns Debe for debt", () => {
    expect(clienteBalanceChip({ deudaPendiente: 500 })).toEqual({ kind: "debe", label: "Debe", amount: 500 })
  })

  it("returns A favor for credit", () => {
    expect(clienteBalanceChip({ saldoCuenta: 200 })).toEqual({ kind: "favor", label: "A favor", amount: 200 })
  })

  it("debt wins over credit", () => {
    expect(clienteBalanceChip({ deudaPendiente: 500, saldoCuenta: 200 })?.kind).toBe("debe")
  })
})
