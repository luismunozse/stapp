import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenesCompraList } from "@/components/ordenes-compra/ordenes-compra-list"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
  }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn(), confirm: vi.fn() }),
}))

/**
 * El listado no tenía ninguna forma de abrir una OC. Los botones de acción
 * (Enviar / Recibir / Cancelar) viven en la última celda y DataTable ya frena
 * la propagación ahí, así que hacer la fila clickeable no debe dispararlos.
 */

const OC = {
  id: "oc1",
  numeroOC: "OC-0001",
  estado: "ENVIADA",
  proveedor: { id: "p1", nombre: "Repuestos del Sur" },
  fechaEmision: "2026-08-01",
  fechaRecepcionEsperada: null,
  subtotal: 1000,
  total: 1000,
  notas: null,
  createdBy: null,
  createdAt: "2026-08-01",
}

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesCompraList />
    </SWRConfig>
  )
}

describe("OrdenesCompraList — abrir el detalle", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    push.mockClear()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [OC] }) })
    )
  })

  it("navega al detalle al hacer click en la fila", async () => {
    renderList()

    fireEvent.click(await screen.findByText("OC-0001"))

    expect(push).toHaveBeenCalledWith("/ordenes-compra/oc1")
  })

  it("no navega al usar un botón de acción de la fila", async () => {
    renderList()

    fireEvent.click(await screen.findByText("Recibir"))

    expect(push).not.toHaveBeenCalled()
  })
})
