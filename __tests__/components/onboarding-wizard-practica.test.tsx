/**
 * The practice path through the whole wizard: from the question to Listo,
 * resuming mid-practice, and the two Listo CTAs (no camino: the practice POST
 * already recorded it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import { bodyOf, callsTo, json, practica, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const PRACTICA_URL = "/api/onboarding/practica"
const LISTO = "¡Listo! Ya viste cómo funciona"

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  mockFetch.mockImplementation(async () => json({}))
})

describe("OnboardingWizard — practice path", () => {
  it("runs the whole practice from the question to Listo", async () => {
    routeFetch(mockFetch, {
      [`POST ${PRACTICA_URL}`]: [json({ practica: practica() }, 201)],
      [`PATCH ${PRACTICA_URL}`]: [
        json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) }),
        json({ practica: practica({ estado: "ENTREGADO_SIN_COBRO", costoFinal: 15000 }) }),
      ],
    })
    render(<OnboardingWizard {...wizardProps()} />)
    fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Todavía no, quiero practicar" }))

    await screen.findByRole("heading", { name: "Cargá tu orden de práctica" })
    fireEvent.change(screen.getByLabelText("Equipo"), { target: { value: "Gafa HGF-357" } })
    fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    await screen.findByRole("heading", { name: "Ahora, la reparación" })
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    await screen.findByRole("heading", { name: "Última parada: la entrega" })
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }))

    expect(await screen.findByRole("heading", { name: LISTO })).toBeInTheDocument()
    expect(screen.getByText("La práctica queda en tu lista hasta que cargues tu primera orden real.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })).toHaveAttribute("href", "/seguimiento/tok-123")
    // Omitir stays available on every step, Listo included.
    expect(screen.getByRole("button", { name: /Omitir/ })).toBeInTheDocument()
    expect(callsTo(mockFetch, "PATCH", PRACTICA_URL).map(bodyOf)).toEqual([
      { accion: "reparar", costoFinal: 15000 },
      { accion: "entregar" },
    ])
  })

  it.each([
    ["RECIBIDO", "Ahora, la reparación"],
    ["REPARADO", "Última parada: la entrega"],
  ] as const)("resumes a practice left in %s", (estado, titulo) => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado, costoFinal: 15000 }) })} />)

    expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Comenzar/i })).not.toBeInTheDocument()
  })

  it("resumes on Listo when the practice was already delivered", () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    expect(screen.getByRole("heading", { name: LISTO })).toBeInTheDocument()
  })

  it("Cargar mi primera orden real completes without camino and navigates once", async () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    fireEvent.click(screen.getByRole("button", { name: "Cargar mi primera orden real" }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
    const complete = callsTo(mockFetch, "POST", "/api/onboarding/complete")
    expect(complete).toHaveLength(1)
    expect(complete[0][1]).toEqual({ method: "POST" })
  })

  it("a double tap on the Listo CTA sends one completion and one navigation", async () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)
    const cta = screen.getByRole("button", { name: "Cargar mi primera orden real" })

    // Both clicks inside one act: React has not re-rendered the disabled state,
    // so only the ref guard can stop the second one.
    await act(async () => {
      fireEvent.click(cta)
      fireEvent.click(cta)
    })

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(callsTo(mockFetch, "POST", "/api/onboarding/complete")).toHaveLength(1)
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
  })

  it("Ir al panel completes and goes to the dashboard", async () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    fireEvent.click(screen.getByRole("button", { name: "Ir al panel" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(push).toHaveBeenCalledTimes(1)
  })

  it("Omitir on Listo completes with camino omitido", async () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    fireEvent.click(screen.getByRole("button", { name: /Omitir/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(bodyOf(callsTo(mockFetch, "POST", "/api/onboarding/complete")[0])).toEqual({ camino: "omitido" })
  })

  it("Omitir still works while a practice error is shown", async () => {
    routeFetch(mockFetch, { [`PATCH ${PRACTICA_URL}`]: [json({ error: "Se cortó" }, 500)] })
    render(<OnboardingWizard {...wizardProps({ practica: practica() })} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))
    await screen.findByRole("alert")

    fireEvent.click(screen.getByRole("button", { name: /Omitir/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(bodyOf(callsTo(mockFetch, "POST", "/api/onboarding/complete")[0])).toEqual({ camino: "omitido" })
  })

  it("Atrás on the practice form returns to the question", async () => {
    render(<OnboardingWizard {...wizardProps()} />)
    fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Todavía no, quiero practicar" }))
    await screen.findByRole("heading", { name: "Cargá tu orden de práctica" })

    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }))

    expect(await screen.findByRole("heading", { name: /para cargar ahora\?/ })).toBeInTheDocument()
  })

  describe("focus on practice sub-step changes", () => {
    it("does not take focus on first mount", () => {
      render(<OnboardingWizard {...wizardProps({ practica: practica() })} />)

      expect(screen.getByRole("heading", { name: "Ahora, la reparación" })).toBeInTheDocument()
      expect(document.body).toHaveFocus()
    })

    it("moves focus to the sub-step title after reparar succeeds", async () => {
      routeFetch(mockFetch, {
        [`PATCH ${PRACTICA_URL}`]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) })],
      })
      render(<OnboardingWizard {...wizardProps({ practica: practica() })} />)
      fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
      fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

      const titulo = await screen.findByRole("heading", { name: "Última parada: la entrega" })

      await waitFor(() => expect(titulo).toHaveFocus())
      expect(titulo).toHaveAttribute("data-paso-titulo")
    })
  })
})
