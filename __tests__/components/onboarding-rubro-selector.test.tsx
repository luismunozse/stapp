import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { useState, type ComponentProps } from "react"
import { RubroSelector } from "@/components/onboarding/wizard/rubro-selector"
import { bodyOf, callsTo, json, routeFetch } from "./onboarding-wizard-fixtures"

const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const RUBRO_URL = "/api/onboarding/rubro"
const RUBRO = `PUT ${RUBRO_URL}`

function renderSelector(overrides: Partial<ComponentProps<typeof RubroSelector>> = {}) {
  const props = {
    rubro: "electrodomesticos",
    rubroDetalle: null,
    bloqueado: false,
    onGuardado: vi.fn(),
    onBloqueado: vi.fn(),
    ...overrides,
  }
  render(<RubroSelector {...props} />)
  return props
}

function abrir() {
  fireEvent.click(screen.getByRole("button", { name: "Cambiar rubro" }))
}

function guardar() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar rubro" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

describe("RubroSelector", () => {
  it("shows the current rubro", () => {
    renderSelector()
    expect(screen.getByText("Electrodomésticos y refrigeración")).toBeInTheDocument()
  })

  it("shows the genérico trade text as the rubro", () => {
    renderSelector({ rubro: "generico", rubroDetalle: "máquinas de café" })
    expect(screen.getByText("Máquinas de café")).toBeInTheDocument()
  })

  it("is disabled with a one-line reason when the shop has real orders", () => {
    renderSelector({ bloqueado: true })

    const cambiar = screen.getByRole("button", { name: "Cambiar rubro" })
    expect(cambiar).toBeDisabled()
    const motivo = screen.getByText("Ya cargaste órdenes, así que el rubro queda como está.")
    expect(cambiar).toHaveAttribute("aria-describedby", motivo.id)
  })

  it("saves a curated rubro and closes", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ rubro: "automotor", rubroDetalle: null, tiposActivos: 3 })] })
    const props = renderSelector()
    abrir()

    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))
    guardar()

    await waitFor(() => expect(props.onGuardado).toHaveBeenCalledWith({ rubro: "automotor", rubroDetalle: null }))
    expect(bodyOf(callsTo(mockFetch, "PUT", RUBRO_URL)[0])).toEqual({ rubro: "automotor", rubroDetalle: null })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("status")).toHaveTextContent("Listo, preparamos tu cuenta para este rubro.")
  })

  it("same rubro: sends the PUT, the server answers 200, the dialog closes and onGuardado is called", async () => {
    routeFetch(mockFetch, {
      [RUBRO]: [json({ rubro: "electrodomesticos", rubroDetalle: null, tiposActivos: 3 })],
    })
    const props = renderSelector()
    abrir()

    guardar()

    await waitFor(() =>
      expect(props.onGuardado).toHaveBeenCalledWith({ rubro: "electrodomesticos", rubroDetalle: null })
    )
    expect(callsTo(mockFetch, "PUT", RUBRO_URL)).toHaveLength(1)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("asks for the trade text before saving genérico", async () => {
    routeFetch(mockFetch, {
      [RUBRO]: [json({ rubro: "generico", rubroDetalle: "máquinas de café", tiposActivos: 3 })],
    })
    const props = renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Otro servicio técnico/ }))

    guardar()
    expect(await screen.findByRole("alert")).toHaveTextContent("Contanos qué reparás para preparar tu cuenta")
    expect(callsTo(mockFetch, "PUT", RUBRO_URL)).toHaveLength(0)

    fireEvent.change(screen.getByRole("textbox", { name: "¿Qué reparás?" }), { target: { value: "máquinas de café" } })
    guardar()

    await waitFor(() =>
      expect(props.onGuardado).toHaveBeenCalledWith({ rubro: "generico", rubroDetalle: "máquinas de café" })
    )
    expect(bodyOf(callsTo(mockFetch, "PUT", RUBRO_URL)[0])).toEqual({ rubro: "generico", rubroDetalle: "máquinas de café" })
  })

  it("keeps the dialog open and reports the lock on 409", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes reales" }, 409)] })
    const props = renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya tenés órdenes reales")
    expect(props.onBloqueado).toHaveBeenCalledTimes(1)
    expect(props.onGuardado).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("refreshes the page after a 500 (the DB may have changed) and shows the error", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "No pudimos cambiar el rubro." }, 500)] })
    const props = renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cambiar el rubro.")
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(props.onGuardado).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("shows a connection error, refreshes the server state and stays open", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    routeFetch(mockFetch, { [RUBRO]: [new TypeError("network down")] })
    renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("alert")).toHaveTextContent(/Revisá tu conexión/)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    // The request may have committed before the connection dropped.
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it("disables Guardar after a 409: the change can no longer succeed", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes reales" }, 409)] })
    renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    await screen.findByRole("alert")
    expect(screen.getByRole("button", { name: "Guardar rubro" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled()
  })

  it("moves focus to the reason line when the dialog closes on a locked trigger", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes reales" }, 409)] })
    function Padre() {
      const [bloqueado, setBloqueado] = useState(false)
      return (
        <RubroSelector
          rubro="electrodomesticos"
          rubroDetalle={null}
          bloqueado={bloqueado}
          onGuardado={vi.fn()}
          onBloqueado={() => setBloqueado(true)}
        />
      )
    }
    render(<Padre />)
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))
    guardar()
    await screen.findByRole("alert")

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    const motivo = await screen.findByText("Ya cargaste órdenes, así que el rubro queda como está.")
    await waitFor(() => expect(motivo).toHaveFocus())
    expect(motivo).toHaveAttribute("tabindex", "-1")
  })

  it("disables Cambiar while the parent says it is busy", () => {
    renderSelector({ deshabilitado: true })
    expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeDisabled()
  })

  it("cannot be dismissed while saving", async () => {
    let responder: (value: unknown) => void = () => {}
    mockFetch.mockImplementation(() => new Promise((resolve) => { responder = resolve }))
    renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("button", { name: "Guardando…" })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    responder(json({ rubro: "automotor", rubroDetalle: null, tiposActivos: 3 }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
