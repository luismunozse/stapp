// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }),
}))

const CLIENTE = { id: null, nombre: "", telefono: "" }

// precioUnitario 1500 con cantidad 1 → total = totalEfectivo = 1500 (sin
// descuentos, sin IVA, sin recargo). Fácil de razonar a mano.
function buildItem(precioUnitario = 1500): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado", codigo: "",
    precioUnitario, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

function renderDialog(precioUnitario = 1500) {
  return render(
    <PosCheckoutDialog
      open
      onClose={() => {}}
      items={[buildItem(precioUnitario)]}
      cliente={CLIENTE as any}
      onComplete={() => {}}
    />
  )
}

describe("PosCheckoutDialog — cálculo de vuelto con decimales es-AR", () => {
  beforeEach(() => {
    // Sin cliente registrado, el diálogo no pide saldo de cuenta corriente;
    // igual llama a recargos-metodo y operadores al abrir.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
  })

  it("no borra la coma mientras se escribe (es-AR) y calcula el vuelto correcto", async () => {
    renderDialog(1500)
    const input = await screen.findByPlaceholderText(/monto recibido/i)

    fireEvent.change(input, { target: { value: "1500,50" } })

    expect(input).toHaveValue("1500,50")
    expect(screen.getByText("$0.5")).toBeInTheDocument()
  })

  it("interpreta el punto como separador de miles cuando hay coma decimal (formato AR)", async () => {
    renderDialog(1500)
    const input = await screen.findByPlaceholderText(/monto recibido/i)

    fireEvent.change(input, { target: { value: "1.500,50" } })

    // 1.500,50 → 1500.50 (no 1.5). Si el punto se leyera como decimal acá,
    // el vuelto calculado sería negativo y quedaría clampeado a $0.
    expect(screen.getByText("$0.5")).toBeInTheDocument()
  })

  it("sigue aceptando el formato de escritorio con punto decimal", async () => {
    renderDialog(1500)
    const input = await screen.findByPlaceholderText(/monto recibido/i)

    fireEvent.change(input, { target: { value: "1500.50" } })

    expect(screen.getByText("$0.5")).toBeInTheDocument()
  })

  it("el vuelto es 0 cuando el monto recibido no alcanza el total", async () => {
    renderDialog(1500)
    const input = await screen.findByPlaceholderText(/monto recibido/i)

    fireEvent.change(input, { target: { value: "1000" } })

    expect(screen.getByText("Faltan $500")).toBeInTheDocument()
    expect(screen.getByText("$0")).toBeInTheDocument()
  })

  it("al borrar el input vuelve al estado vacío, sin NaN filtrándose a la UI", async () => {
    renderDialog(1500)
    const input = await screen.findByPlaceholderText(/monto recibido/i)

    fireEvent.change(input, { target: { value: "1500,50" } })
    fireEvent.change(input, { target: { value: "" } })

    expect(input).toHaveValue("")
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(screen.getByText("$0")).toBeInTheDocument()
  })

  it("un botón de monto rápido carga el valor y actualiza el vuelto", async () => {
    renderDialog(1500)
    const boton = await screen.findByRole("button", { name: "$2000" })

    fireEvent.click(boton)

    expect(screen.getByText("$500")).toBeInTheDocument()
  })
})
