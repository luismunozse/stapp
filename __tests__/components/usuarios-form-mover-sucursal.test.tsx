import { describe, it, expect, vi, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"

// The section itself is covered in mover-sucursal.test.tsx; here we only pin WHERE
// it is mounted and with what, so the stub exposes its props.
vi.mock("@/components/usuarios/mover-sucursal", () => ({
  MoverSucursal: (p: { usuarioId: string; sucursales: unknown[] }) => (
    <div data-testid="mover-sucursal" data-usuario={p.usuarioId} data-sucursales={p.sucursales.length} />
  ),
}))

import { TecnicoForm } from "@/components/tecnicos/tecnico-form"
import { VendedorForm } from "@/components/vendedores/vendedor-form"

const SUCURSALES = [
  { id: "suc-a", nombre: "Casa Central", principal: true },
  { id: "suc-b", nombre: "Cerro", principal: false },
]

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function stubApi() {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.startsWith("/api/sucursales") ? json({ data: SUCURSALES }) : json([])
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** Body of the form's own PUT (not a stub: the real handleSubmit runs). */
const cuerpoDelPut = (fetchMock: ReturnType<typeof stubApi>, url: string) => {
  const llamada = fetchMock.mock.calls.find(([u, init]) => u === url && init?.method === "PUT")
  expect(llamada, `PUT ${url}`).toBeDefined()
  return JSON.parse(String(llamada![1]!.body)) as Record<string, unknown>
}

const renderTecnico = (tecnico: React.ComponentProps<typeof TecnicoForm>["tecnico"]) =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <TecnicoForm open onOpenChange={() => {}} tecnico={tecnico} onSuccess={() => {}} />
    </SWRConfig>
  )

const TECNICO = { id: "tec-1", nombre: "Tomás", email: "tomas@test.com" }
const VENDEDOR = { id: "ven-1", nombre: "Vera", email: "vera@test.com" }

describe("Mover de sucursal en los formularios de usuario", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("TecnicoForm: al editar monta la sección con el técnico y las sucursales, y no ofrece el select de alta", async () => {
    stubApi()
    renderTecnico(TECNICO)

    const seccion = await screen.findByTestId("mover-sucursal")
    expect(seccion).toHaveAttribute("data-usuario", "tec-1")
    await waitFor(() => expect(seccion).toHaveAttribute("data-sucursales", "2"))
    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument()
  })

  it("TecnicoForm: al crear no hay sección de mover; sí el select de alta", async () => {
    stubApi()
    renderTecnico(null)

    expect(await screen.findByLabelText("Sucursal")).toBeInTheDocument()
    expect(screen.queryByTestId("mover-sucursal")).not.toBeInTheDocument()
  })

  it("VendedorForm: al editar monta la sección con el vendedor y las sucursales, y no ofrece el select de alta", async () => {
    stubApi()
    render(<VendedorForm open onOpenChange={() => {}} vendedor={VENDEDOR} onSuccess={() => {}} />)

    const seccion = await screen.findByTestId("mover-sucursal")
    expect(seccion).toHaveAttribute("data-usuario", "ven-1")
    await waitFor(() => expect(seccion).toHaveAttribute("data-sucursales", "2"))
    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument()
  })

  it("TecnicoForm: guardar una edición no manda sucursalId (la sucursal solo se cambia con Mover de sucursal)", async () => {
    const fetchMock = stubApi()
    renderTecnico(TECNICO)
    // Wait until the branches are loaded, so the form HAS a default branch in state that it could leak.
    await waitFor(() => expect(screen.getByTestId("mover-sucursal")).toHaveAttribute("data-sucursales", "2"))

    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true))
    const cuerpo = cuerpoDelPut(fetchMock, "/api/tecnicos/tec-1")
    expect(cuerpo).toMatchObject({ nombre: "Tomás", email: "tomas@test.com" })
    expect(cuerpo).not.toHaveProperty("sucursalId")
  })

  it("VendedorForm: guardar una edición no manda sucursalId (la sucursal solo se cambia con Mover de sucursal)", async () => {
    const fetchMock = stubApi()
    render(<VendedorForm open onOpenChange={() => {}} vendedor={VENDEDOR} onSuccess={() => {}} />)
    await waitFor(() => expect(screen.getByTestId("mover-sucursal")).toHaveAttribute("data-sucursales", "2"))

    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true))
    const cuerpo = cuerpoDelPut(fetchMock, "/api/vendedores/ven-1")
    expect(cuerpo).toMatchObject({ nombre: "Vera", email: "vera@test.com" })
    expect(cuerpo).not.toHaveProperty("sucursalId")
  })

  it("VendedorForm: al crear no hay sección de mover; sí el select de alta", async () => {
    stubApi()
    render(<VendedorForm open onOpenChange={() => {}} vendedor={null} onSuccess={() => {}} />)

    expect(await screen.findByLabelText("Sucursal")).toBeInTheDocument()
    expect(screen.queryByTestId("mover-sucursal")).not.toBeInTheDocument()
  })
})
