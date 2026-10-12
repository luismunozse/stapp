// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
const showError = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: (...a: unknown[]) => showError(...a), showSuccess: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }),
}))

function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado", codigo: "",
    precioUnitario: 1000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

// Item con series pendientes de elegir: dispara el error de validación ANTES
// de cualquier llamada de red, para probar que el guard se libera tras un
// retorno temprano por validación (no sólo tras un submit exitoso).
function buildItemSinSeries(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Router", codigo: "",
    precioUnitario: 1000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: true, serieIds: [],
  }
}

const CLIENTE = { id: "c1", nombre: "Ana", telefono: "" }

function stubFetch() {
  const calls: Array<{ url: string; body: any }> = []
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null
    calls.push({ url, body })
    if (url.includes("/check-stock")) {
      return { ok: true, json: async () => ({ stock: { inv1: 10 } }) }
    }
    if (url.includes("/cuenta-corriente")) {
      return { ok: true, json: async () => ({ saldo: 0 }) }
    }
    if (url.includes("/recargos-metodo")) {
      return { ok: true, json: async () => ({ recargos: [] }) }
    }
    if (url.includes("/operadores")) {
      return { ok: true, json: async () => [] }
    }
    return { ok: true, json: async () => ({ ventaId: "v1" }) }
  })
  vi.stubGlobal("fetch", impl)
  return calls
}

// Igual que stubFetch, pero el check-stock queda pendiente hasta que el test
// llama a resolveStock() — simula una conexión lenta para probar el estado
// "cargando" mientras el pre-check todavía está en vuelo.
function stubFetchStockPendiente() {
  const calls: Array<{ url: string; body: any }> = []
  let resolveStock: () => void = () => {}
  const stockGate = new Promise<void>((resolve) => {
    resolveStock = resolve
  })
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null
    calls.push({ url, body })
    if (url.includes("/check-stock")) {
      await stockGate
      return { ok: true, json: async () => ({ stock: { inv1: 10 } }) }
    }
    if (url.includes("/cuenta-corriente")) {
      return { ok: true, json: async () => ({ saldo: 0 }) }
    }
    if (url.includes("/recargos-metodo")) {
      return { ok: true, json: async () => ({ recargos: [] }) }
    }
    if (url.includes("/operadores")) {
      return { ok: true, json: async () => [] }
    }
    return { ok: true, json: async () => ({ ventaId: "v1" }) }
  })
  vi.stubGlobal("fetch", impl)
  return { calls, resolveStock }
}

describe("PosCheckoutDialog — Confirmar venta no reentra", () => {
  beforeEach(() => {
    showError.mockClear()
  })

  it("dos clicks rápidos en Confirmar generan un solo alta de venta", async () => {
    const calls = stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)
    fireEvent.click(boton)

    await waitFor(() => {
      expect(calls.filter((c) => c.url === "/api/ventas")).toHaveLength(1)
    })
  })

  it("el botón queda deshabilitado mientras el pre-chequeo de stock está en vuelo", async () => {
    const { resolveStock } = stubFetchStockPendiente()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)

    await waitFor(() => expect(boton).toBeDisabled())

    await act(async () => {
      resolveStock()
    })

    await waitFor(() => expect(boton).not.toBeDisabled())
  })

  it("tras un error de validación temprano, el botón vuelve a estar disponible", async () => {
    stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItemSinSeries()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)

    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(boton).not.toBeDisabled())

    // Si el guard hubiera quedado trabado en `true`, este segundo click no
    // dispararía nada.
    fireEvent.click(boton)
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(2))
  })
})
