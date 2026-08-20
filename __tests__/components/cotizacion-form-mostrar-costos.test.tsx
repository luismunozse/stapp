import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

const initialDataConCosto = {
  id: "cot-1",
  items: [
    {
      id: "item-1",
      descripcion: "Pantalla",
      cantidad: 1,
      precioUnitario: 900,
      inventarioId: "inv-1",
      precioCompra: 300,
    },
  ],
}

describe("CotizacionForm — resumen de costo/ganancia visible solo con mostrarCostos", () => {
  const setupFetch = () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response))
    )
  }

  it("oculta 'Costo repuestos' y 'Ganancia bruta' por defecto (roles no admin)", () => {
    setupFetch()

    render(
      <ModalProvider>
        <CotizacionForm
          ordenId="orden-1"
          initialData={initialDataConCosto}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </ModalProvider>
    )

    expect(screen.queryByText("Costo repuestos:")).not.toBeInTheDocument()
    expect(screen.queryByText("Ganancia bruta:")).not.toBeInTheDocument()
  })

  it("muestra 'Costo repuestos' y 'Ganancia bruta' cuando mostrarCostos esta activo (admin)", () => {
    setupFetch()

    render(
      <ModalProvider>
        <CotizacionForm
          ordenId="orden-1"
          initialData={initialDataConCosto}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          mostrarCostos
        />
      </ModalProvider>
    )

    expect(screen.getByText("Costo repuestos:")).toBeInTheDocument()
    expect(screen.getByText("Ganancia bruta:")).toBeInTheDocument()
  })

  it("envia el id del item existente en el payload del PUT (para preservar el costo en el servidor)", async () => {
    setupFetch()
    const onSuccess = vi.fn()

    render(
      <ModalProvider>
        <CotizacionForm
          ordenId="orden-1"
          initialData={initialDataConCosto}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      </ModalProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: /Actualizar Cotización/ }))

    await waitFor(() => {
      const putCall = (fetch as any).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "PUT"
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall[1].body)
      expect(body.items[0].id).toBe("item-1")
    })
  })
})
