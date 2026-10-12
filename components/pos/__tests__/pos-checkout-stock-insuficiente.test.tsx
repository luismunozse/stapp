// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

// showError queda pendiente hasta que el test la resuelve — igual que en
// pos-checkout-validacion-sincronica.test.tsx — para poder aserciones sobre
// el estado del diálogo MIENTRAS la alerta de stock insuficiente sigue
// abierta.
let resolveShowError: () => void = () => {}
const showError = vi.fn(
  (_message: string) =>
    new Promise<void>((resolve) => {
      resolveShowError = resolve
    })
)
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: (msg: string) => showError(msg), showSuccess: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }),
}))

const CLIENTE = { id: "c1", nombre: "Ana", telefono: "" }

function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado", codigo: "",
    precioUnitario: 1000, cantidad: 3, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/check-stock")) {
        // Se piden 3, sólo hay 1 disponible: conflicto de stock.
        return { ok: true, json: async () => ({ stock: { inv1: 1 } }) }
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
      return { ok: true, json: async () => ({}) }
    })
  )
}

describe("PosCheckoutDialog — stock insuficiente detectado en el pre-chequeo no finge estar procesando", () => {
  beforeEach(() => {
    showError.mockClear()
  })

  it("mientras la alerta de 'Stock insuficiente' sigue abierta, el diálogo no muestra 'Procesando' y puede cerrarse", async () => {
    stubFetch()
    const onClose = vi.fn()
    render(
      <PosCheckoutDialog
        open onClose={onClose} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)

    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))
    expect(showError.mock.calls[0][0]).toMatch(/stock insuficiente/i)

    // No hay ningún trabajo async en vuelo (el check-stock ya resolvió y no
    // se llegó a llamar a /api/ventas): el diálogo no debería seguir
    // mostrando el spinner ni bloquear el cierre.
    expect(screen.queryByText(/procesando/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancelar/i })).not.toBeDisabled()

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)

    resolveShowError()
  })

  it("un segundo click mientras la alerta sigue abierta NO dispara un segundo submit (el guard de reentrancia sigue activo)", async () => {
    stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))

    fireEvent.click(boton)
    expect(showError).toHaveBeenCalledTimes(1)

    resolveShowError()
  })
})
