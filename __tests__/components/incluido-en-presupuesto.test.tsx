/**
 * Migración 421: con un presupuesto vigente, al cargar un repuesto o servicio
 * se pregunta si ya está dentro del presupuesto o suma aparte al cobro. No se
 * adivina: la mayoría de los talleres carga en Repuestos lo mismo que cotizó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { OrdenRepuestosTab } from "@/components/ordenes/orden-repuestos-tab"

const cotizacion = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  numero_cotizacion: "COT-0059",
  estado: "ENVIADA",
  total: 35000,
  deleted_at: null,
  reemplazada_por: null,
  ...over,
})

function setupFetch() {
  const mockFetch = vi.fn((_url: string, _opts?: RequestInit) =>
    Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response),
  )
  vi.stubGlobal("fetch", mockFetch)
  return mockFetch
}

function cargarManual() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
  fireEvent.click(screen.getByRole("button", { name: "Manual" }))
  fireEvent.change(screen.getByPlaceholderText("Ej: Flex de carga iPhone 12"), { target: { value: "Pin" } })
  fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "7000" } })
}

const posts = (mockFetch: ReturnType<typeof setupFetch>) =>
  mockFetch.mock.calls.filter(([, o]) => o?.method === "POST")

describe("OrdenRepuestosTab con presupuesto vigente", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("pregunta si ya está en el presupuesto y no deja agregar sin responder", async () => {
    const mockFetch = setupFetch()
    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="o1" repuestos={[]} cotizaciones={[cotizacion()]} onRepuestosChanged={vi.fn()} />
      </ModalProvider>,
    )
    cargarManual()

    expect(screen.getByText(/Esta orden tiene presupuesto \(COT-0059\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    expect(await screen.findByText(/Indicá si este repuesto ya está incluido/)).toBeInTheDocument()
    expect(posts(mockFetch)).toHaveLength(0)
  })

  it("'Ya está en el presupuesto' manda incluidoEnPresupuesto: true", async () => {
    const mockFetch = setupFetch()
    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="o1" repuestos={[]} cotizaciones={[cotizacion()]} onRepuestosChanged={vi.fn().mockResolvedValue(undefined)} />
      </ModalProvider>,
    )
    cargarManual()
    fireEvent.click(screen.getByLabelText(/Ya está en el presupuesto/))
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    await waitFor(() => expect(posts(mockFetch)).toHaveLength(1))
    expect(JSON.parse(posts(mockFetch)[0][1]!.body as string)).toMatchObject({ incluidoEnPresupuesto: true })
  })

  it("con el presupuesto rechazado no pregunta y el repuesto suma", async () => {
    const mockFetch = setupFetch()
    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="o1"
          repuestos={[]}
          cotizaciones={[cotizacion({ estado: "RECHAZADA" })]}
          onRepuestosChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </ModalProvider>,
    )
    cargarManual()
    expect(screen.queryByText(/Esta orden tiene presupuesto/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    await waitFor(() => expect(posts(mockFetch)).toHaveLength(1))
    expect(JSON.parse(posts(mockFetch)[0][1]!.body as string)).toMatchObject({ incluidoEnPresupuesto: false })
  })

  it("cada repuesto muestra su marca y tocarla la cambia con PATCH", async () => {
    const mockFetch = setupFetch()
    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="o1"
          repuestos={[{ id: "r1", nombre: "Pin", cantidad: 1, precioUnitario: 7000, precioVentaUnitario: 35000, incluidoEnPresupuesto: true }]}
          cotizaciones={[cotizacion()]}
          onRepuestosChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </ModalProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "En el presupuesto" }))

    await waitFor(() => {
      const p = mockFetch.mock.calls.find(([, o]) => o?.method === "PATCH")
      expect(p).toBeDefined()
      expect(p![0]).toBe("/api/ordenes/o1/repuestos?repuestoId=r1")
      expect(JSON.parse(p![1]!.body as string)).toEqual({ incluidoEnPresupuesto: false })
    })
  })
})
