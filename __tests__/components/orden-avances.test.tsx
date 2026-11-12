import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { OrdenAvances } from "@/components/ordenes/orden-avances"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatDateTime: () => "11/11/2026 12:00" }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const existente = {
  id: "ev-1", texto: "Se desarmó el equipo", estado: "EN_REPARACION", visibleCliente: false,
  createdAt: "2026-11-11T12:00:00Z", autorId: "otro", autor: "Ana",
}

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body))
    return { ok: true, json: async () => ({ ...existente, id: "ev-2", texto: body.texto, visibleCliente: body.visibleCliente, autorId: "yo" }) } as Response
  }
  return { ok: true, json: async () => [existente] } as Response
})

const renderAvances = (props: { isAdmin?: boolean } = {}) =>
  render(
    <ModalProvider>
      <OrdenAvances ordenId="ord-1" userId="yo" isAdmin={props.isAdmin ?? false} />
    </ModalProvider>
  )

describe("OrdenAvances", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("muestra los avances con su visibilidad y no deja borrar uno ajeno", async () => {
    renderAvances()
    expect(await screen.findByText("Se desarmó el equipo")).toBeInTheDocument()
    expect(screen.getByText(/Interno/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Borrar avance")).not.toBeInTheDocument()
  })

  it("un ADMIN puede borrar cualquiera", async () => {
    renderAvances({ isAdmin: true })
    expect(await screen.findByLabelText("Borrar avance")).toBeInTheDocument()
  })

  it("agrega un avance interno cuando se destilda la visibilidad", async () => {
    renderAvances()
    await screen.findByText("Se desarmó el equipo")
    fireEvent.change(screen.getByLabelText("Nuevo avance"), { target: { value: "Cambio de conector" } })
    fireEvent.click(screen.getByLabelText(/Visible para el cliente/))
    fireEvent.click(screen.getByRole("button", { name: /Agregar avance/ }))

    await waitFor(() => expect(screen.getByText("Cambio de conector")).toBeInTheDocument())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(post[0]).toBe("/api/ordenes/ord-1/avances")
    expect(JSON.parse(String(post[1]!.body))).toEqual({ texto: "Cambio de conector", visibleCliente: false })
  })
})
