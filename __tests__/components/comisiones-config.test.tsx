// __tests__/components/comisiones-config.test.tsx
/**
 * Repair-commission rules screen (Configuración > Comisiones). ADMIN only; it saves by itself
 * (PUT the whole rule set), like the Avisos tab.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { BASE_OPTIONS, COMMISSION_CONFIG_DEFAULTS, ORDER_ACCRUAL_OPTIONS } from "@/lib/commissions/config"

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const SERVER_CONFIG = { ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: false }

function respond(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

async function renderScreen(allowEdit = true) {
  const { ComisionesConfig } = await import("@/components/configuracion/comisiones-config")
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ComisionesConfig allowEdit={allowEdit} />
    </SWRConfig>,
  )
}

describe("ComisionesConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue(respond(SERVER_CONFIG))
  })

  it("shows each option with what it implies and the current values", async () => {
    await renderScreen()

    expect(
      await screen.findByText("Una orden entregada con saldo pendiente no genera comisión hasta que se cobra todo."),
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Al entregar la orden y tenerla cobrada por completo/ })).toBeChecked()
    expect(screen.getByText(/un cambio no modifica órdenes ya recibidas/)).toBeInTheDocument()
    expect(screen.getByText(/También se aplica a los administradores que reciben equipos\./)).toBeInTheDocument()
    expect(screen.getByLabelText("Porcentaje de recepción por defecto")).toHaveValue(0)
    expect(screen.getByRole("checkbox", { name: /Los reingresos por garantía generan comisión/ })).not.toBeChecked()
    expect(
      screen.getByRole("checkbox", { name: /Las órdenes entregadas sin reparar generan comisión/ }),
    ).not.toBeChecked()
  })

  it("saves the whole rule set with PUT and confirms", async () => {
    await renderScreen()
    await screen.findByText("Comisiones de reparaciones")

    mockFetch.mockResolvedValueOnce(respond({ ...SERVER_CONFIG, ordenDevengo: "ENTREGA", recepcionPorcentajeDefault: 5 }))
    fireEvent.click(screen.getByRole("radio", { name: /^Al entregar la orden(?! y)/ }))
    fireEvent.change(screen.getByLabelText("Porcentaje de recepción por defecto"), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reglas de comisiones guardadas"))
    const put = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")
    expect(put?.[0]).toBe("/api/comisiones/config")
    expect(put?.[1]).toEqual(
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          ...COMMISSION_CONFIG_DEFAULTS,
          ordenDevengo: "ENTREGA",
          recepcionPorcentajeDefault: 5,
          sinReparacionComisiona: false,
        }),
      }),
    )
  })

  it("shows the server error and keeps the edits", async () => {
    await renderScreen()
    await screen.findByText("Comisiones de reparaciones")

    mockFetch.mockResolvedValueOnce(
      respond({ error: "El porcentaje de recepción debe estar entre 0 y 100" }, false, 400),
    )
    fireEvent.change(screen.getByLabelText("Porcentaje de recepción por defecto"), { target: { value: "7" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("El porcentaje de recepción debe estar entre 0 y 100"),
    )
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Porcentaje de recepción por defecto")).toHaveValue(7)
  })

  it("falls back to a generic message when the server sends no error text", async () => {
    await renderScreen()
    await screen.findByText("Comisiones de reparaciones")

    mockFetch.mockResolvedValueOnce(respond({}, false, 500))
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudieron guardar las reglas"))
  })

  it("shows the load error when the rules cannot be read", async () => {
    mockFetch.mockResolvedValue(respond({ error: "Prohibido" }, false, 403))
    await renderScreen()

    expect(await screen.findByText("No se pudieron cargar las reglas de comisiones.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Guardar reglas" })).not.toBeInTheDocument()
  })

  it("blocks saving an empty or out-of-range rate and never coerces it to 0", async () => {
    await renderScreen()
    await screen.findByText("Comisiones de reparaciones")
    const input = screen.getByLabelText("Porcentaje de recepción por defecto")
    const save = screen.getByRole("button", { name: "Guardar reglas" })
    const callsBefore = mockFetch.mock.calls.length

    fireEvent.change(input, { target: { value: "" } })
    expect(screen.getByText("Ingrese un porcentaje entre 0 y 100.")).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input.getAttribute("aria-describedby")).toContain("comision-recepcion-error")
    expect(save).toBeDisabled()
    fireEvent.click(save)

    fireEvent.change(input, { target: { value: "150" } })
    expect(save).toBeDisabled()
    expect(mockFetch.mock.calls.length).toBe(callsBefore)

    mockFetch.mockResolvedValueOnce(respond({ ...SERVER_CONFIG, recepcionPorcentajeDefault: 5 }))
    fireEvent.change(input, { target: { value: "5" } })
    expect(screen.queryByText("Ingrese un porcentaje entre 0 y 100.")).not.toBeInTheDocument()
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const put = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")
    expect(JSON.parse(put![1].body).recepcionPorcentajeDefault).toBe(5)
  })

  it("does not report an error when the save worked but the refresh failed", async () => {
    await renderScreen()
    await screen.findByText("Comisiones de reparaciones")

    mockFetch.mockResolvedValueOnce(respond(SERVER_CONFIG))
    mockFetch.mockRejectedValueOnce(new Error("network"))
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reglas de comisiones guardadas"))
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(toastError).not.toHaveBeenCalled()
  })

  it("offers no Save button while loading", async () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    await renderScreen()

    expect(await screen.findByText("Cargando...")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Guardar reglas" })).not.toBeInTheDocument()
  })

  it("allowEdit=false disables every control", async () => {
    await renderScreen(false)
    await screen.findByText("Comisiones de reparaciones")

    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(ORDER_ACCRUAL_OPTIONS.length + 2 * BASE_OPTIONS.length)
    for (const radio of radios) expect(radio).toBeDisabled()
    expect(screen.getByLabelText("Porcentaje de recepción por defecto")).toBeDisabled()
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled()
    expect(screen.getByRole("button", { name: "Guardar reglas" })).toBeDisabled()
  })
})
