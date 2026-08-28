// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

// showError queda pendiente hasta que el test la resuelve — así se puede
// aserciones sobre el estado del diálogo MIENTRAS la alerta sigue abierta
// (que es exactamente lo que se quiere evitar: loading en true sin nada
// async en vuelo).
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

// Item con series pendientes de elegir: dispara una validación puramente
// sincrónica (sin red) antes de cualquier fetch.
function buildItemSinSeries(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Router", codigo: "",
    precioUnitario: 1000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: true, serieIds: [],
  }
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  )
}

describe("PosCheckoutDialog — una validación puramente sincrónica no finge estar procesando", () => {
  beforeEach(() => {
    showError.mockClear()
    vi.unstubAllGlobals()
  })

  it("mientras la alerta de validación sigue abierta, el diálogo no muestra 'Procesando' y puede cerrarse", async () => {
    stubFetch()
    const onClose = vi.fn()
    render(
      <PosCheckoutDialog
        open onClose={onClose} items={[buildItemSinSeries()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)

    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))

    // No hay ningún trabajo async en vuelo (la validación fue 100% síncrona):
    // el diálogo no debería seguir mostrando el spinner ni bloquear el cierre.
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
        open onClose={() => {}} items={[buildItemSinSeries()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    const boton = await screen.findByRole("button", { name: /confirmar venta/i })
    fireEvent.click(boton)
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))

    // Aunque `loading` ya volvió a false (el botón visualmente no está
    // deshabilitado), `submittingRef` sigue en true hasta que handleSubmit
    // termine de verdad: un segundo click no debe generar una segunda alerta.
    fireEvent.click(boton)
    expect(showError).toHaveBeenCalledTimes(1)

    resolveShowError()
  })
})
