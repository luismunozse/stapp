import { describe, it, expect, vi, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"

vi.mock("@/components/usuarios/mover-sucursal", () => ({
  MoverSucursal: () => <div data-testid="mover-sucursal" />,
}))

import { TecnicoForm } from "@/components/tecnicos/tecnico-form"
import { VendedorForm } from "@/components/vendedores/vendedor-form"

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function stubApi() {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.startsWith("/api/sucursales") ? json({ data: [] }) : json([])
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const bodyOfPut = async (fetchMock: ReturnType<typeof stubApi>, url: string) => {
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u, init]) => u === url && init?.method === "PUT")).toBe(true)
  )
  const call = fetchMock.mock.calls.find(([u, init]) => u === url && init?.method === "PUT")!
  return JSON.parse(String(call[1]!.body)) as Record<string, unknown>
}

const VENDEDOR = { id: "ven-1", nombre: "Vera", email: "vera@test.com" }
const TECNICO = { id: "tec-1", nombre: "Tomas", email: "tomas@test.com" }

const renderVendedor = (vendedor: React.ComponentProps<typeof VendedorForm>["vendedor"]) =>
  render(<VendedorForm open onOpenChange={() => {}} vendedor={vendedor} onSuccess={() => {}} />)
const renderTecnico = (tecnico: React.ComponentProps<typeof TecnicoForm>["tecnico"]) =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <TecnicoForm open onOpenChange={() => {}} tecnico={tecnico} onSuccess={() => {}} />
    </SWRConfig>
  )

const field = () => screen.getByLabelText("Comisión por recepción (%)") as HTMLInputElement

describe("reception rate in the person forms", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("VendedorForm: blank posts null, a value posts the number", async () => {
    const fetchMock = stubApi()
    const first = renderVendedor(VENDEDOR)
    expect(field().value).toBe("")
    expect(field()).toHaveAttribute("placeholder", "Por defecto del taller")
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/vendedores/ven-1")).porcentajeComisionRecepcion).toBeNull()
    first.unmount()

    fetchMock.mockClear()
    renderVendedor(VENDEDOR)
    fireEvent.change(field(), { target: { value: "4.5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/vendedores/ven-1")).porcentajeComisionRecepcion).toBe(4.5)
  })

  it("TecnicoForm: blank posts null, a value posts the number", async () => {
    const fetchMock = stubApi()
    const first = renderTecnico(TECNICO)
    expect(field().value).toBe("")
    expect(field()).toHaveAttribute("placeholder", "Por defecto del taller")
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/tecnicos/tec-1")).porcentajeComisionRecepcion).toBeNull()
    first.unmount()

    fetchMock.mockClear()
    renderTecnico(TECNICO)
    fireEvent.change(field(), { target: { value: "4.5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/tecnicos/tec-1")).porcentajeComisionRecepcion).toBe(4.5)
  })

  it("a typed 0 is sent as 0, not as blank", async () => {
    const fetchMock = stubApi()
    renderVendedor({ ...VENDEDOR, porcentajeComisionRecepcion: 2 })
    expect(field().value).toBe("2")
    fireEvent.change(field(), { target: { value: "0" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/vendedores/ven-1")).porcentajeComisionRecepcion).toBe(0)
  })

  it("prefills the stored rate from the prop", () => {
    stubApi()
    renderTecnico({ ...TECNICO, porcentajeComisionRecepcion: 6 })
    expect(field().value).toBe("6")
  })

  it("VendedorForm opened later by the parent (open flips, vendedor arrives) prefills every field", async () => {
    const fetchMock = stubApi()
    const { rerender } = render(
      <VendedorForm open={false} onOpenChange={() => {}} vendedor={null} onSuccess={() => {}} />
    )
    rerender(
      <VendedorForm
        open
        onOpenChange={() => {}}
        vendedor={{ ...VENDEDOR, nombre: "Ana", porcentajeComision: 5, porcentajeComisionRecepcion: 3.5 }}
        onSuccess={() => {}}
      />
    )
    expect(field().value).toBe("3.5")
    expect((screen.getByLabelText("Porcentaje de comisión (%)") as HTMLInputElement).value).toBe("5")
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Ana")

    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/vendedores/ven-1")).porcentajeComisionRecepcion).toBe(3.5)
  })

  it("explains the default and the snapshot", () => {
    stubApi()
    renderVendedor(VENDEDOR)
    expect(
      screen.getByText(/Cada orden guarda el porcentaje vigente al recibir el equipo/)
    ).toBeInTheDocument()
  })
})

describe("technician form never zeroes a rate or an hourly cost by accident", () => {
  afterEach(() => vi.unstubAllGlobals())

  const rate = () => screen.getByLabelText("% Comisión sobre ganancia") as HTMLInputElement
  const puts = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")

  it("a blank commission rate blocks the submit with an inline message", async () => {
    const fetchMock = stubApi()
    renderTecnico({ ...TECNICO, porcentajeComision: 10 })
    fireEvent.change(rate(), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect(await screen.findByText("Ingrese un porcentaje entre 0 y 100.")).toBeInTheDocument()
    expect(puts(fetchMock)).toHaveLength(0)
  })

  it("a typed 0 commission rate is still valid", async () => {
    const fetchMock = stubApi()
    renderTecnico({ ...TECNICO, porcentajeComision: 10 })
    fireEvent.change(rate(), { target: { value: "0" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/tecnicos/tec-1")).porcentajeComision).toBe(0)
  })

  it("editing a technician whose hourly cost was not loaded omits costoHora", async () => {
    const fetchMock = stubApi()
    renderTecnico({ ...TECNICO, porcentajeComision: 10 })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    const body = await bodyOfPut(fetchMock, "/api/tecnicos/tec-1")
    expect(body).not.toHaveProperty("costoHora")
  })

  it("a loaded hourly cost is sent back as is", async () => {
    const fetchMock = stubApi()
    renderTecnico({ ...TECNICO, porcentajeComision: 10, costoHora: 12.5 })
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))
    expect((await bodyOfPut(fetchMock, "/api/tecnicos/tec-1")).costoHora).toBe(12.5)
  })
})
