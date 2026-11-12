import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { EstadoFisicoCard } from "@/components/ordenes/danos/estado-fisico-card"
import type { DanoOrden } from "@/lib/ordenes/danos"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }))

const AHORA = new Date("2026-11-12T15:00:00.000Z")

const dano = (o: Partial<DanoOrden>): DanoOrden => ({
  id: "d1",
  numero: 1,
  momento: "recepcion",
  createdAt: "2026-11-12T10:00:00.000Z",
  createdByNombre: null,
  diagrama: "celular",
  vista: "frente",
  x: 0.5,
  y: 0.5,
  tipo: "rayon",
  nota: null,
  ...o,
})

const recepcion = dano({ id: "r1", numero: 1 })
const diag = (o: Partial<DanoOrden> = {}) =>
  dano({ id: "g1", numero: 2, momento: "diagnostico", tipo: "golpe", createdByNombre: "Ana Pérez", createdAt: "2026-11-12T14:58:00.000Z", ...o })

let fetchMock: ReturnType<typeof vi.fn>

function respuesta(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

function montar(get: { danos: DanoOrden[]; sinDanos?: boolean }, puedeAgregar = true) {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (!init || !init.method || init.method === "GET") {
      return respuesta({ danos: get.danos, sinDanos: get.sinDanos ?? false, diagrama: "celular", puedeAgregar })
    }
    return respuesta({}, 201)
  })
  return render(<EstadoFisicoCard ordenId="o1" />)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AHORA)
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  toastError.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("EstadoFisicoCard", () => {
  it("muestra los grupos Al recibir (con candado) y Detectados en diagnóstico (con autor y fecha)", async () => {
    montar({ danos: [recepcion, diag()] })
    expect(await screen.findByText("Al recibir")).toBeInTheDocument()
    expect(screen.getByText("Detectados en diagnóstico")).toBeInTheDocument()
    expect(screen.getByText("Firmado por el cliente")).toBeInTheDocument()
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument()
  })

  it("con sinDanos muestra 'Sin daños visibles al ingreso'", async () => {
    montar({ danos: [], sinDanos: true })
    expect(await screen.findByText("Sin daños visibles al ingreso")).toBeInTheDocument()
  })

  it("sin pins ni sinDanos avisa que no se registró y ofrece agregar", async () => {
    montar({ danos: [] })
    expect(await screen.findByText("No se registró el estado físico al recibir el equipo")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar daño detectado" })).toBeInTheDocument()
  })

  it("sin permiso no muestra el botón de agregar", async () => {
    montar({ danos: [recepcion] }, false)
    await screen.findByText("Al recibir")
    expect(screen.queryByRole("button", { name: "Agregar daño detectado" })).not.toBeInTheDocument()
  })

  it("agregar hace POST con el diagrama del GET y vuelve a cargar la lista", async () => {
    montar({ danos: [recepcion] })
    await screen.findByText("Al recibir")
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      !init?.method || init.method === "GET"
        ? respuesta({ danos: [recepcion, diag({ createdByNombre: "Luis" })], sinDanos: false, diagrama: "celular", puedeAgregar: true })
        : respuesta({}, 201),
    )
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño detectado" }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño" }))
    fireEvent.click(screen.getByRole("button", { name: "Golpe" }))
    await waitFor(() => expect(screen.getByText("Detectados en diagnóstico")).toBeInTheDocument())
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!
    expect(post[0]).toBe("/api/ordenes/o1/danos")
    expect(JSON.parse(post[1].body)).toMatchObject({ diagrama: "celular", vista: "frente", tipo: "golpe" })
    expect(screen.getByText(/Luis/)).toBeInTheDocument()
  })

  it("el borrado solo aparece en pins de diagnóstico de menos de 10 minutos", async () => {
    montar({
      danos: [recepcion, diag({ id: "g1", numero: 2 }), diag({ id: "g2", numero: 3, createdAt: "2026-11-12T14:40:00.000Z" })],
    })
    await screen.findByText("Al recibir")
    expect(screen.getByRole("button", { name: "Quitar daño 2" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Quitar daño 3" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Quitar daño 1" })).not.toBeInTheDocument()
  })

  it("borrar hace DELETE y recarga", async () => {
    montar({ danos: [recepcion, diag()] })
    await screen.findByText("Al recibir")
    fireEvent.click(screen.getByRole("button", { name: "Quitar daño 2" }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/ordenes/o1/danos/g1" && c[1]?.method === "DELETE")).toBe(true),
    )
  })

  it("un 409 muestra el error del servidor en un toast", async () => {
    montar({ danos: [recepcion] })
    await screen.findByText("Al recibir")
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === "POST" ? respuesta({ error: "La orden ya está cerrada" }, 409) : respuesta({ danos: [recepcion], sinDanos: false, diagrama: "celular", puedeAgregar: true }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño detectado" }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotura" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("La orden ya está cerrada"))
  })

  it("un GET fallido muestra el error y Reintentar vuelve a pedir", async () => {
    fetchMock.mockImplementation(() => respuesta({ error: "x" }, 500))
    render(<EstadoFisicoCard ordenId="o1" />)
    expect(await screen.findByText("No se pudo cargar el estado físico")).toBeInTheDocument()
    fetchMock.mockImplementation(() => respuesta({ danos: [recepcion], sinDanos: false, diagrama: "celular", puedeAgregar: false }))
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByText("Al recibir")).toBeInTheDocument()
  })

  it("un DELETE fallido muestra el error del servidor en un toast", async () => {
    montar({ danos: [recepcion, diag()] })
    await screen.findByText("Al recibir")
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === "DELETE" ? respuesta({ error: "Pasaron más de 10 minutos; el daño ya no se puede borrar" }, 409) : respuesta({}),
    )
    fireEvent.click(screen.getByRole("button", { name: "Quitar daño 2" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Pasaron más de 10 minutos; el daño ya no se puede borrar"))
  })

  it("si el refetch tras agregar falla, muestra el error inline", async () => {
    montar({ danos: [recepcion] })
    await screen.findByText("Al recibir")
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === "POST" ? respuesta({}, 201) : respuesta({ error: "x" }, 500),
    )
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño detectado" }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño" }))
    fireEvent.click(screen.getByRole("button", { name: "Golpe" }))
    expect(await screen.findByText("No se pudo cargar el estado físico")).toBeInTheDocument()
  })
})
