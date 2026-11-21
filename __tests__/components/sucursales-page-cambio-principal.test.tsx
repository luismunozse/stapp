import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("@/components/configuracion/sucursal-whatsapp-card", () => ({
  SucursalWhatsAppCard: () => null,
}))

import SucursalesPage from "@/app/(dashboard)/configuracion/sucursales/page"

const sucursales = [
  { id: "suc-colon", nombre: "Colón", codigo: null, direccion: null, telefono: null, notas: null, principal: true, activo: true, createdAt: "" },
  { id: "suc-rioja", nombre: "Rioja", codigo: null, direccion: null, telefono: null, notas: null, principal: false, activo: true, createdAt: "" },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const aviso = (over: Record<string, unknown> = {}) => ({
  error: "tiene stock",
  code: "PRINCIPAL_CON_STOCK",
  sucursalActual: "Colón",
  items: 408,
  unidades: 1793,
  ...over,
})

function setup(putResponses: Response[]) {
  const puts: any[] = []
  const queue = [...putResponses]
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push({ url, body: JSON.parse(String(init.body)) })
      return queue.shift()!
    }
    return json({ data: sucursales })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { puts, fetchMock }
}

async function promoverRioja() {
  render(<SucursalesPage />)
  await screen.findByText("Rioja")
  // Segundo boton de editar (Rioja): el primero es el de Colón
  fireEvent.click(screen.getAllByRole("button").filter((b) => b.querySelector("svg.lucide-pencil"))[1])
  fireEvent.click(screen.getAllByRole("switch")[0])
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
}

describe("Sucursales: cambio de principal con stock", () => {
  beforeEach(() => vi.clearAllMocks())

  it("la ayuda del switch aclara que no mueve stock", async () => {
    setup([])
    render(<SucursalesPage />)
    await screen.findByText("Rioja")
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.querySelector("svg.lucide-pencil"))[1])
    expect(
      screen.getByText(
        "Solo una puede ser principal. Es el default cuando una operación no especifica sucursal. No mueve el stock entre depósitos."
      )
    ).toBeInTheDocument()
  })

  it("409 PRINCIPAL_CON_STOCK abre la confirmación con los números y no muestra error", async () => {
    setup([json(aviso(), 409)])
    await promoverRioja()

    expect(await screen.findByText("¿Cambiar la sucursal principal?")).toBeInTheDocument()
    const cuerpo = screen.getByText(/tiene 408 productos \(1\.793 unidades\)/)
    expect(cuerpo.textContent).toContain("va a seguir en Colón")
    expect(cuerpo.textContent).toContain("usan Rioja")
    expect(cuerpo.textContent).toContain("transferila antes")
    expect(screen.queryByText("tiene stock")).not.toBeInTheDocument()
  })

  it("usa singular con 1 producto y 1 unidad", async () => {
    setup([json(aviso({ items: 1, unidades: 1 }), 409)])
    await promoverRioja()
    expect(await screen.findByText(/tiene 1 producto \(1 unidad\)/)).toBeInTheDocument()
  })

  it("Cambiar igual reenvía el mismo body con confirmarCambioPrincipal y refresca", async () => {
    const { puts, fetchMock } = setup([json(aviso(), 409), json({ id: "suc-rioja" }, 200)])
    await promoverRioja()
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar igual" }))

    await waitFor(() => expect(puts).toHaveLength(2))
    const { confirmarCambioPrincipal: _omit, ...primero } = puts[1].body
    expect(puts[0].body.confirmarCambioPrincipal).toBeUndefined()
    expect(puts[1].body.confirmarCambioPrincipal).toBe(true)
    expect(primero).toEqual(puts[0].body)
    expect(puts[1].url).toBe("/api/sucursales/suc-rioja")
    await waitFor(() => expect(screen.queryByText("¿Cambiar la sucursal principal?")).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText("Editar sucursal")).not.toBeInTheDocument())
    // refetch de la lista tras guardar
    expect(fetchMock.mock.calls.filter(([, i]) => !i?.method).length).toBeGreaterThanOrEqual(2)
  })

  it("Cancelar cierra la confirmación y deja el formulario con lo que escribió el usuario", async () => {
    const { puts } = setup([json(aviso(), 409)])
    await promoverRioja()
    const titulo = await screen.findByText("¿Cambiar la sucursal principal?")
    fireEvent.click(within(titulo.closest('[role="dialog"]') as HTMLElement).getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(screen.queryByText("¿Cambiar la sucursal principal?")).not.toBeInTheDocument())
    expect(screen.getByText("Editar sucursal")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Rioja")).toBeInTheDocument()
    expect(puts).toHaveLength(1)
  })

  it("otros errores siguen mostrándose en el formulario", async () => {
    setup([json({ error: "Ya existe una sucursal con ese nombre" }, 400)])
    await promoverRioja()
    expect(await screen.findByText("Ya existe una sucursal con ese nombre")).toBeInTheDocument()
    expect(screen.queryByText("¿Cambiar la sucursal principal?")).not.toBeInTheDocument()
  })
})
