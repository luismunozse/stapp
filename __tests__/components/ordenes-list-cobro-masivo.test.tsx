/**
 * Lista de órdenes: la etiqueta de cobro ("Debe $X" / "Cobrado") y la
 * confirmación del cambio de estado masivo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenesList } from "@/components/ordenes/ordenes-list"
import { silenceSkeletonNoise } from "./silence-skeleton-noise"

const confirm = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/ordenes",
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "ADMIN" } } }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn(), confirm }),
}))
vi.mock("@/components/ordenes/orden-form", () => ({ OrdenForm: () => null }))
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

const base = {
  numeroOrden: 1,
  estado: "REPARADO",
  dispositivo: "A52",
  tipoDispositivo: "CELULAR",
  fechaIngreso: "2026-10-11",
  esPractica: false,
  cliente: { id: "c", nombre: "Ana", telefono: "" },
}
// estadoPago/saldoPendiente los calcula GET /api/ordenes (lib/ordenes/resumen-cobro):
// la lista solo los dibuja.
const DEBE = { ...base, id: "o-1", codigoOrden: "CEL0001", costoFinal: 15000, totalCobrado: 5000, descuentoCobro: 0, aplicadoNotasCredito: 0, estadoPago: "PARCIAL", saldoPendiente: 10000 }
const PAGA = { ...base, id: "o-2", codigoOrden: "CEL0002", estado: "ENTREGADO", costoFinal: 8000, totalCobrado: 8000, descuentoCobro: 0, aplicadoNotasCredito: 0, estadoPago: "PAGADO", saldoPendiente: 0 }

const EN_CC = { ...base, id: "o-3", codigoOrden: "CEL0003", estado: "ENTREGADO", costoFinal: 800, totalCobrado: 0, descuentoCobro: 0, aplicadoNotasCredito: 0, estadoPago: "CUENTA_CORRIENTE", saldoPendiente: 0, montoEstado: 800 }

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  silenceSkeletonNoise()
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/ordenes?")) return { ok: true, status: 200, json: async () => ({ data: [DEBE, PAGA, EN_CC], total: 3 }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const renderList = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesList />
    </SWRConfig>
  )

const puts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")

async function cambiarSeleccionadaA(estado: string) {
  renderList()
  await screen.findAllByText("Debe $10000")
  const antes = new Set(screen.getAllByTestId("select"))
  const fila = screen.getAllByRole("checkbox").find((c) => !!c.closest("tr") && !(c as HTMLInputElement).checked && c.closest("tbody"))!
  fireEvent.click(fila)
  const bulk = await waitFor(() => {
    const nuevo = screen.getAllByTestId("select").find((s) => !antes.has(s))
    if (!nuevo) throw new Error("sin select masivo")
    return nuevo
  })
  fireEvent.change(bulk, { target: { value: estado } })
}

describe("OrdenesList — cobro y cambio masivo", () => {
  it("muestra Debe $X y Cobrado", async () => {
    renderList()
    expect((await screen.findAllByText("Debe $10000")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("Cobrado").length).toBeGreaterThan(0)
  })

  it("con el saldo en cuenta corriente muestra 'En cuenta corriente' y el monto, nunca 'Debe'", async () => {
    renderList()
    expect((await screen.findAllByText("En cuenta corriente")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("$800").length).toBeGreaterThan(0)
    expect(screen.queryByText("Debe $800")).not.toBeInTheDocument()
  })

  it("pide confirmación y, si se cancela, no cambia nada", async () => {
    confirm.mockResolvedValue(false)
    await cambiarSeleccionadaA("EN_REPARACION")
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(confirm.mock.calls[0][0].title).toMatch(/Cambiar 1 orden a En reparación/)
    expect(puts()).toHaveLength(0)
  })

  it("al confirmar, aplica el cambio", async () => {
    confirm.mockResolvedValue(true)
    await cambiarSeleccionadaA("EN_REPARACION")
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({ estado: "EN_REPARACION" })
  })
})
