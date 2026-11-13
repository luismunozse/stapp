import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { InventarioBulkBar } from "@/components/inventario/inventario-bulk-bar"
import { formatCurrencyValue } from "@/lib/currency"
import { AjustePreciosProveedor } from "@/components/proveedores/ajuste-precios-proveedor"

const confirmMock = vi.hoisted(() => vi.fn())
const swrData = vi.hoisted(() => ({ items: [] as unknown[] }))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: confirmMock, showError: vi.fn(), showSuccess: vi.fn() }),
}))
vi.mock("@/components/export/export-button", () => ({ ExportButton: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `ARS ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`,
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))
vi.mock("swr", () => ({
  default: (key: string) =>
    key.startsWith("/api/inventario")
      ? { data: { data: swrData.items }, isLoading: false }
      : { data: { id: "p1", nombre: "Proveedor X" }, isLoading: false },
}))

describe("ajuste masivo de inventario con monedas mezcladas", () => {
  beforeEach(() => confirmMock.mockReset().mockResolvedValue(false))

  async function ajustar(monedas: Array<string | null>) {
    render(
      <InventarioBulkBar
        selectedCount={monedas.length}
        selectedIds={monedas.map((_, i) => `i${i}`)}
        selectedMonedas={monedas}
        monedaLocal="ARS"
        categoriasDisponibles={[]}
        onClear={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /^precio$/i }))
    fireEvent.change(await screen.findByPlaceholderText("ej: 10 o -5"), { target: { value: "10" } })
    const aplicar = screen.getAllByRole("button", { name: "Aplicar" })
    fireEvent.click(aplicar[aplicar.length - 1])
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    return confirmMock.mock.calls[0][0].description as string
  }

  it("dice cuántos ítems hay en cada moneda cuando hay mezcla", async () => {
    const d = await ajustar([null, null, null, "USD", "USD"])
    expect(d).toContain("3 en ARS y 2 en USD: el porcentaje se aplica en la moneda de cada uno")
  })

  it("no dice nada cuando todos están en la misma moneda", async () => {
    const d = await ajustar(["USD", "USD"])
    expect(d).not.toContain("en la moneda de cada uno")
  })
})

describe("ajuste por proveedor con monedas mezcladas", () => {
  it("redondea a 10 solo el ítem local; el de divisa queda en centavos", () => {
    swrData.items = [
      { id: "a", codigo: "L1", nombre: "Local", stock: 1, precioCompra: null, precioVenta: 4700, moneda: null },
      { id: "b", codigo: "D1", nombre: "Divisa", stock: 1, precioCompra: null, precioVenta: 47, moneda: "USD" },
    ]
    render(<AjustePreciosProveedor proveedorId="p1" />)
    fireEvent.change(screen.getByLabelText("% ajuste venta"), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("combobox"))
    fireEvent.click(screen.getByRole("option", { name: "Múltiplos de 10" }))

    expect(screen.getByPlaceholderText("4940")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("49.35")).toBeInTheDocument()
    expect(screen.getByText(formatCurrencyValue(47, "USD"))).toBeInTheDocument()
  })
})
