/**
 * Configuración → Rubro: the place to change the rubro that is always
 * reachable, and a locked state that says how to get past the lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { RubroConfig } from "@/components/configuracion/rubro-config"
import { CONTACT_EMAIL } from "@/lib/contact"
import { json, routeFetch } from "./onboarding-wizard-fixtures"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))

const refreshConfig = vi.fn()
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ refreshConfig }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch
const RUBRO = "PUT /api/onboarding/rubro"

function renderConfig(overrides: Partial<ComponentProps<typeof RubroConfig>> = {}) {
  const props = {
    rubro: "electronica",
    rubroDetalle: null,
    tipos: ["Celular", "Computadora", "Tablet"],
    equipo: "Equipo",
    ordenesReales: 0,
    ...overrides,
  }
  return render(<RubroConfig {...props} />)
}

function cambiarA(nombre: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Cambiar rubro" }))
  fireEvent.click(screen.getByRole("radio", { name: nombre }))
  fireEvent.click(screen.getByRole("button", { name: "Guardar rubro" }))
}

describe("RubroConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it("shows the current rubro and what it set up, each linking to where it is edited", () => {
    renderConfig()

    expect(screen.getByText("Electrónica y computación")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Tipos de equipo.*Celular, Computadora, Tablet/ })).toHaveAttribute(
      "href",
      "/configuracion/tipos-dispositivo"
    )
    expect(screen.getByRole("link", { name: /Checklist de recepción/ })).toHaveAttribute("href", "/configuracion/checklist")
    expect(screen.getByRole("link", { name: /Vocabulario.*“Equipo”/ })).toHaveAttribute("href", "/configuracion/vocabulario")
  })

  it("says so when the tipos could not be read, instead of an empty list", () => {
    renderConfig({ tipos: null })
    expect(screen.getByText("No pudimos leerlos. Abrí la sección para verlos.")).toBeInTheDocument()
  })

  it("changes the rubro, then reloads the vocabulary and the server snapshot", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ rubro: "electrodomesticos", rubroDetalle: null, tiposActivos: 5 })] })
    renderConfig()

    cambiarA(/Electrodomésticos y refrigeración/)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    expect(screen.getByText("Electrodomésticos y refrigeración")).toBeInTheDocument()
    expect(screen.queryByText("Electrónica y computación")).not.toBeInTheDocument()
    expect(refreshConfig).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("with real orders, Cambiar is off and the reason says how many and what to do", () => {
    renderConfig({ ordenesReales: 3 })

    const cambiar = screen.getByRole("button", { name: "Cambiar rubro" })
    expect(cambiar).toBeDisabled()
    const motivo = document.getElementById(cambiar.getAttribute("aria-describedby")!)!
    expect(motivo).toHaveTextContent(
      `Tenés 3 órdenes cargadas, así que el rubro queda como está. Si eran de prueba, eliminalas desde Órdenes y lo vas a poder cambiar. Si son trabajos reales, escribinos a ${CONTACT_EMAIL} y lo vemos con vos.`
    )
    expect(screen.getByRole("link", { name: "Órdenes" })).toHaveAttribute("href", "/ordenes")
    expect(screen.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`)
  })

  it("uses the singular for one order", () => {
    renderConfig({ ordenesReales: 1 })
    expect(screen.getByText(/Tenés 1 orden cargada, así que/)).toBeInTheDocument()
  })

  it("a 409 locks Cambiar and re-reads the snapshot for the real count", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes cargadas" }, 409)] })
    renderConfig()

    cambiarA(/Taller mecánico/)

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya tenés órdenes cargadas")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeDisabled())
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Ya cargaste órdenes, así que el rubro queda como está/)).toBeInTheDocument()
  })
})
