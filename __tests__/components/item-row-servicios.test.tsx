import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ItemRow } from "@/components/cotizaciones/item-row"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))

const SERVICIO = {
  id: "srv-1",
  codigo: "SRV-001",
  nombre: "Instalación de Windows",
  precio: 25000,
  categoria: "Software",
}

describe("ItemRow (cotización) — picker de servicios", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes("/api/servicios")) {
        return new Response(JSON.stringify({ servicios: [SERVICIO] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }) as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function abrirBuscador(onUpdate: (index: number, field: string, value: string | number | null) => void) {
    render(
      <ItemRow
        item={{ descripcion: "", cantidad: 1, precioUnitario: 0, descuentoValor: 0 }}
        index={0}
        onUpdate={onUpdate}
        onRemove={() => {}}
      />
    )
    fireEvent.click(screen.getAllByTitle(/^Buscar/i)[0])
    const input = screen.getAllByPlaceholderText(/^Buscar/i)[0]
    fireEvent.change(input, { target: { value: "win" } })
  }

  it("carga nombre y precio del servicio elegido y guarda el vínculo con el catálogo", async () => {
    const onUpdate = vi.fn()
    abrirBuscador(onUpdate)

    // item-row monta los dos layouts (responsive); ambos comparten el mismo state.
    const opciones = await screen.findAllByText(SERVICIO.nombre, {}, { timeout: 3000 })
    fireEvent.click(opciones[0])

    expect(onUpdate).toHaveBeenCalledWith(0, "descripcion", "Instalación de Windows")
    expect(onUpdate).toHaveBeenCalledWith(0, "precioUnitario", 25000)
    expect(onUpdate).toHaveBeenCalledWith(0, "servicioId", "srv-1")
  })

  it("marca la unidad como Servicio, para distinguirla de un producto", async () => {
    const onUpdate = vi.fn()
    abrirBuscador(onUpdate)

    // item-row monta los dos layouts (responsive); ambos comparten el mismo state.
    const opciones = await screen.findAllByText(SERVICIO.nombre, {}, { timeout: 3000 })
    fireEvent.click(opciones[0])

    expect(onUpdate).toHaveBeenCalledWith(0, "unidad", "Servicio")
  })

  it("no vincula inventario ni arrastra costo: un servicio no tiene stock ni precio de compra", async () => {
    const onUpdate = vi.fn()
    abrirBuscador(onUpdate)

    // item-row monta los dos layouts (responsive); ambos comparten el mismo state.
    const opciones = await screen.findAllByText(SERVICIO.nombre, {}, { timeout: 3000 })
    fireEvent.click(opciones[0])

    const campos = onUpdate.mock.calls.map((c) => c[1])
    expect(campos).not.toContain("inventarioId")
    expect(campos).not.toContain("precioCompra")
  })
})
