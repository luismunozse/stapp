// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
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

function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado", codigo: "",
    precioUnitario: 1000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

function renderDialog(cliente: { id: string | null; nombre: string }) {
  return render(
    <PosCheckoutDialog
      open
      onClose={() => {}}
      items={[buildItem()]}
      cliente={{ ...cliente, telefono: "" } as any}
      onComplete={() => {}}
    />
  )
}

describe("PosCheckoutDialog — el fiado se llama fiado", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saldo: 0 }) })
    )
  })

  it("ofrece 'Fiar / Cuenta corriente' cuando hay un cliente registrado", async () => {
    renderDialog({ id: "c1", nombre: "Ana" })

    const boton = await screen.findByRole("button", { name: /fiar \/ cuenta corriente/i })
    expect(boton).toBeEnabled()
  })

  it("deshabilita el fiado y explica por qué cuando no hay cliente", async () => {
    renderDialog({ id: null, nombre: "" })

    const boton = await screen.findByRole("button", { name: /fiar \/ cuenta corriente/i })
    expect(boton).toBeDisabled()
    expect(screen.getByText(/seleccioná un cliente para fiar/i)).toBeInTheDocument()
  })
})
