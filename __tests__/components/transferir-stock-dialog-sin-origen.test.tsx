import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { TransferirStockDialog } from "@/components/inventario/transferir-stock-dialog"

function fila(id: string, puedeOrigen: boolean) {
  return {
    depositoId: id,
    depositoNombre: `Deposito ${id}`,
    principal: false,
    activo: true,
    puedeOrigen,
    stock: 5,
    stockReservado: 0,
    disponible: 5,
  }
}

function mockDepositos(rows: ReturnType<typeof fila>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({ data: rows, discrepancia: 0, item: { stockTotal: 10 } }),
    })
  )
}

function renderDialog() {
  render(
    <TransferirStockDialog
      open
      onOpenChange={() => {}}
      inventarioId="inv-1"
      inventarioNombre="Item"
    />
  )
}

describe("TransferirStockDialog — origen elegible", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("sin depositos de origen elegibles explica por que y no muestra el formulario", async () => {
    mockDepositos([fila("a", false), fila("b", false)])
    renderDialog()

    expect(
      await screen.findByText(/Tu sucursal no tiene depósitos con este producto para transferir/)
    ).toBeTruthy()
    expect(screen.queryByText("Origen")).toBeNull()
  })

  it("con al menos un origen elegible muestra el formulario como siempre", async () => {
    mockDepositos([fila("a", true), fila("b", false)])
    renderDialog()

    await waitFor(() => expect(screen.getByText("Origen")).toBeTruthy())
    expect(screen.queryByText(/Tu sucursal no tiene depósitos/)).toBeNull()
  })
})
