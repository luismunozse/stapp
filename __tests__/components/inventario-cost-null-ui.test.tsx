import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { InventarioAnalyticsModal } from "@/components/inventario/inventario-analytics-modal"
import { KitDialog } from "@/components/inventario/kit-dialog"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
  }),
}))

// Los endpoints de inventario devuelven null en los campos de costo para los
// roles sin acceso. Estos componentes los tipaban como number y los pintaban
// sin condicion, asi que el usuario veia "$0" — un precio real, no un permiso
// faltante.

describe("InventarioAnalyticsModal — valorStock nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const base = {
    ventasUlt30d: 3,
    ventasUlt90d: 9,
    promedioDiario30: 0.1,
    promedioDiario90: 0.1,
    diasDeStockRestantes: 40,
    ultimaVenta: "2026-08-01",
    sinMovimientoDias: 5,
    disponible: 4,
    stockReservado: 0,
    puntoReorden: 2,
  }

  function stubFetch(payload: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => payload } as Response)),
    )
  }

  it("oculta 'Valor en stock' cuando el rol no puede ver costos", async () => {
    stubFetch({ ...base, valorStock: null })

    render(
      <InventarioAnalyticsModal
        open
        onOpenChange={vi.fn()}
        inventarioId="inv-1"
        inventarioNombre="Pantalla"
      />,
    )

    await waitFor(() => expect(screen.getByText("Punto de reorden")).toBeInTheDocument())
    expect(screen.queryByText("Valor en stock")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
  })

  it("muestra 'Valor en stock' cuando el rol si puede ver costos", async () => {
    stubFetch({ ...base, valorStock: 1200 })

    render(
      <InventarioAnalyticsModal
        open
        onOpenChange={vi.fn()}
        inventarioId="inv-2"
        inventarioNombre="Pantalla"
      />,
    )

    await waitFor(() => expect(screen.getByText("Valor en stock")).toBeInTheDocument())
    expect(screen.getByText("$1200")).toBeInTheDocument()
  })
})

describe("KitDialog — costos nulos en la receta", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function kitPayload(costs: { costoCalculado: number | null; precioCompra: number | null; subtotalCosto: number | null }) {
    return {
      kit: {
        id: "kit-1",
        codigo: "K1",
        nombre: "Kit reparacion",
        stock: 2,
        stockReservado: 0,
        precioCompra: costs.precioCompra,
        precioVenta: 5000,
        esKit: true,
        tipoKit: "ENSAMBLADO",
        imagenUrl: null,
      },
      componentes: [
        {
          id: "comp-1",
          componenteId: "inv-9",
          cantidad: 2,
          esObligatorio: true,
          notas: null,
          orden: 0,
          componente: {
            id: "inv-9",
            codigo: "C9",
            nombre: "Tornillo",
            stock: 50,
            stockReservado: 0,
            disponible: 50,
            precioCompra: costs.precioCompra,
            imagenUrl: null,
            esKit: false,
            tipoKit: null,
          },
          subtotalCosto: costs.subtotalCosto,
        },
      ],
      costoCalculado: costs.costoCalculado,
      explosionado: null,
    }
  }

  function stubFetch(payload: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("/api/depositos")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => payload } as Response)
      }),
    )
  }

  it("oculta el costo total y el costo por componente cuando vienen en null", async () => {
    stubFetch(kitPayload({ costoCalculado: null, precioCompra: null, subtotalCosto: null }))

    render(
      <KitDialog open onOpenChange={vi.fn()} inventarioId="kit-1" inventarioNombre="Kit reparacion" />,
    )

    await waitFor(() => expect(screen.getByText("Tornillo")).toBeInTheDocument())

    expect(screen.queryByText("Costo total receta")).not.toBeInTheDocument()
    expect(screen.queryByText(/Costo \$/)).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // Lo que no es costo sigue disponible.
    expect(screen.getByText(/Disp\./)).toBeInTheDocument()
  })

  it("muestra el costo total y el costo por componente cuando el rol puede verlos", async () => {
    stubFetch(kitPayload({ costoCalculado: 900, precioCompra: 450, subtotalCosto: 900 }))

    render(
      <KitDialog open onOpenChange={vi.fn()} inventarioId="kit-2" inventarioNombre="Kit reparacion" />,
    )

    await waitFor(() => expect(screen.getByText("Costo total receta")).toBeInTheDocument())
    // $900 aparece dos veces: costo total de la receta y subtotal del componente.
    expect(screen.getAllByText("$900").length).toBeGreaterThan(0)
  })
})
