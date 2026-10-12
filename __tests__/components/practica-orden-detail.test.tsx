import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PracticaOrdenDetail } from "@/components/ordenes/practica-orden-detail"
import type { OrdenServicio } from "@/types"

const push = vi.fn()
const confirm = vi.fn()
const showError = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: () => "11/10/2026" }),
  useTerminologia: () => (key: string) => (key === "equipo" ? "Artefacto" : key),
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm, showError }) }))
vi.mock("@/components/ordenes/notification-history", () => ({
  NotificationHistory: () => <div data-testid="historial" />,
}))

function orden(overrides: Partial<OrdenServicio> = {}): OrdenServicio {
  return {
    id: "prac-1",
    numeroOrden: 0,
    codigoOrden: "PRACTICA",
    clienteId: "cli-prac",
    dispositivo: "Gafa HGF-357",
    tipoDispositivo: "HELADERA",
    problemaReportado: "No enfría",
    estado: "REPARADO",
    costoFinal: 15000,
    fechaIngreso: new Date("2026-10-11T12:00:00Z"),
    publicToken: "tok-123",
    esPractica: true,
    cliente: {
      id: "cli-prac",
      nombre: "Ana Pérez",
      telefono: "",
      email: "ana@taller.test",
      createdAt: new Date("2026-10-11T12:00:00Z"),
      updatedAt: new Date("2026-10-11T12:00:00Z"),
    },
    ...overrides,
  }
}

describe("PracticaOrdenDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
  })

  it("shows the practice order read-only, with the badge and the owner as the client", () => {
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    expect(screen.getByRole("heading", { name: "Orden de práctica" })).toBeInTheDocument()
    expect(screen.getByText("Práctica")).toBeInTheDocument()
    expect(screen.getByText(/se borra cuando cargues tu primera orden real/)).toBeInTheDocument()
    expect(screen.getByText(/acá no se cobra, no se mueve stock y no se factura/)).toBeInTheDocument()
    expect(screen.getByText("Vos")).toBeInTheDocument()
    expect(screen.getByText("ana@taller.test")).toBeInTheDocument()
    expect(screen.getByText("Artefacto")).toBeInTheDocument()
    expect(screen.getByText("Gafa HGF-357")).toBeInTheDocument()
    expect(screen.getByText("No enfría")).toBeInTheDocument()
    expect(screen.getByText("$15000")).toBeInTheDocument()
    expect(screen.getByTestId("historial")).toBeInTheDocument()
  })

  it("opens the tracking page in a new tab", () => {
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    const link = screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })
    expect(link).toHaveAttribute("href", "/seguimiento/tok-123")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("offers to resume the practice until it is delivered", () => {
    const { unmount } = render(<PracticaOrdenDetail orden={orden({ estado: "RECIBIDO" })} isAdmin />)
    expect(screen.getByRole("link", { name: "Seguir con la práctica" })).toHaveAttribute("href", "/onboarding")
    unmount()

    render(<PracticaOrdenDetail orden={orden({ estado: "ENTREGADO_SIN_COBRO" })} isAdmin />)
    expect(screen.queryByRole("link", { name: "Seguir con la práctica" })).not.toBeInTheDocument()
  })

  it("Borrar práctica deletes it and goes back to the list", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal("fetch", fetchMock)
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    fireEvent.click(screen.getByRole("button", { name: /Borrar práctica/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/ordenes"))
    expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/practica", { method: "DELETE" })
  })

  it("a failed delete shows the server message and stays on the order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "No se pudo borrar" }) }))
    )
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    fireEvent.click(screen.getByRole("button", { name: /Borrar práctica/ }))

    await waitFor(() => expect(showError).toHaveBeenCalledWith("No se pudo borrar"))
    expect(push).not.toHaveBeenCalled()
  })

  it("non-admins see the real client name, without the practice controls", () => {
    render(<PracticaOrdenDetail orden={orden()} isAdmin={false} />)
    expect(screen.queryByText("Vos")).not.toBeInTheDocument()
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument()
  })

  it("non-admins get the view without the practice controls", () => {
    render(<PracticaOrdenDetail orden={orden({ estado: "RECIBIDO" })} isAdmin={false} />)

    expect(screen.queryByRole("button", { name: /Borrar práctica/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Seguir con la práctica" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })).toBeInTheDocument()
  })
})
