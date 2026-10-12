/**
 * The practice sub-steps (recibir, reparar, entregar) against
 * /api/onboarding/practica. A harness holds the practice the way the wizard
 * shell does, so every server response drives the next sub-step.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { PracticaStep } from "@/components/onboarding/wizard/practica-step"
import type { TipoPractica } from "@/components/onboarding/wizard/types"
import { formatCurrencyValue } from "@/lib/currency"
import { PRACTICA_PROBLEMAS_GENERICOS, type PracticaOrden } from "@/lib/onboarding/practica-shared"
import { resolveTerminologia } from "@/lib/terminologia"
import { bodyOf, callsTo, json, practica, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const PRACTICA_URL = "/api/onboarding/practica"
const CREAR = `POST ${PRACTICA_URL}`
const AVANZAR = `PATCH ${PRACTICA_URL}`
const LEER = `GET ${PRACTICA_URL}`

function Harness({
  inicial = null,
  tipos = wizardProps().tipos,
  onChange = () => {},
  onAtras = () => {},
}: {
  inicial?: PracticaOrden | null
  tipos?: TipoPractica[]
  onChange?: (p: PracticaOrden | null) => void
  onAtras?: () => void
}) {
  const [actual, setActual] = useState<PracticaOrden | null>(inicial)
  return (
    <PracticaStep
      practica={actual}
      tipos={tipos}
      terminologia={resolveTerminologia({ equipo: "Artefacto" })}
      ownerEmail="ana@taller.test"
      moneda="ARS"
      onPracticaChange={(p) => {
        onChange(p)
        setActual(p)
      }}
      onAtras={onAtras}
    />
  )
}

function cargarFormulario() {
  fireEvent.change(screen.getByLabelText("Artefacto"), { target: { value: "Gafa HGF-357" } })
  fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
}

function etapaActual() {
  return within(screen.getByRole("list", { name: "Avance de la práctica" }))
    .getAllByRole("listitem")
    .find((li) => li.getAttribute("aria-current") === "step")
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

describe("PracticaStep — recibir", () => {
  it("preselects the first active tipo and shows the owner as the client", () => {
    render(<Harness />)

    expect(screen.getByLabelText("Tipo")).toHaveValue("HELADERA")
    expect(screen.getByText("Vos · ana@taller.test")).toBeInTheDocument()
    expect(etapaActual()).toHaveTextContent("Recibida")
  })

  it("brand chips fill the device text and problem chips fill the problem", () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Gafa" }))
    expect(screen.getByLabelText("Artefacto")).toHaveValue("Gafa ")
    expect(screen.getByLabelText("Artefacto")).toHaveFocus()
    expect(screen.getByRole("button", { name: "Gafa" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "Pierde agua" }))
    expect(screen.getByLabelText("Problema")).toHaveValue("Pierde agua")
  })

  it("switching the tipo switches the suggestions", () => {
    render(<Harness />)

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "LAVARROPAS" } })

    expect(screen.getByRole("button", { name: "Drean" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "No centrifuga" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "No enfría" })).not.toBeInTheDocument()
  })

  it("falls back to the generic problems when the tipo has none (genérico)", () => {
    const generico: TipoPractica[] = [
      { codigo: "MAQUINA_DE_CAFE", nombre: "Máquina de café", marcas: [], problemasComunes: [] },
    ]
    render(<Harness tipos={generico} />)

    const grupo = screen.getByRole("group", { name: "Problemas comunes" })
    expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual([...PRACTICA_PROBLEMAS_GENERICOS])
    expect(screen.queryByRole("group", { name: "Marcas sugeridas" })).not.toBeInTheDocument()
  })

  it("keeps the submit disabled until the device and the problem are filled", () => {
    render(<Harness />)
    const enviar = screen.getByRole("button", { name: "Cargar orden de práctica" })

    expect(enviar).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Artefacto"), { target: { value: "Gafa" } })
    expect(enviar).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
    expect(enviar).toBeEnabled()
  })

  it("explains what is missing while the submit is disabled, linked with aria-describedby", () => {
    render(<Harness />)
    const enviar = screen.getByRole("button", { name: "Cargar orden de práctica" })

    const ayuda = screen.getByText("Completá marca y modelo y contanos qué le pasa.")
    expect(enviar).toHaveAttribute("aria-describedby", ayuda.id)

    fireEvent.change(screen.getByLabelText("Artefacto"), { target: { value: "Gafa" } })
    expect(screen.getByText("Contanos qué le pasa.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
    expect(enviar).toBeEnabled()
    expect(enviar).not.toHaveAttribute("aria-describedby")
    expect(screen.queryByText(/Contanos qué le pasa|Completá marca/)).not.toBeInTheDocument()
  })

  it("creates the practice and moves to reparar with the tracking link", async () => {
    routeFetch(mockFetch, { [CREAR]: [json({ practica: practica() }, 201)] })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    cargarFormulario()

    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    expect(await screen.findByRole("heading", { name: "Ahora, la reparación" })).toBeInTheDocument()
    expect(bodyOf(callsTo(mockFetch, "POST", PRACTICA_URL)[0])).toEqual({
      tipoDispositivo: "HELADERA",
      dispositivo: "Gafa HGF-357",
      problemaReportado: "No enfría",
    })
    expect(onChange).toHaveBeenCalledWith(practica())
    expect(screen.getByText("Le mandamos un email a ana@taller.test: así se entera tu cliente.")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })
    expect(link).toHaveAttribute("href", "/seguimiento/tok-123")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(etapaActual()).toHaveTextContent("Reparada")
  })

  it("shows the error with Reintentar and repeats the same request", async () => {
    routeFetch(mockFetch, {
      [CREAR]: [json({ error: "Se cortó la base" }, 500), json({ practica: practica() }, 201)],
    })
    render(<Harness />)
    cargarFormulario()
    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Se cortó la base")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    expect(await screen.findByRole("heading", { name: "Ahora, la reparación" })).toBeInTheDocument()
    expect(callsTo(mockFetch, "POST", PRACTICA_URL)).toHaveLength(2)
    expect(bodyOf(callsTo(mockFetch, "POST", PRACTICA_URL)[1])).toEqual(bodyOf(callsTo(mockFetch, "POST", PRACTICA_URL)[0]))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("Atrás goes back to the question", () => {
    const onAtras = vi.fn()
    render(<Harness onAtras={onAtras} />)

    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }))

    expect(onAtras).toHaveBeenCalledTimes(1)
  })

  it("explains when the org has no active tipo", () => {
    render(<Harness tipos={[]} />)

    expect(screen.getByRole("alert")).toHaveTextContent(/al menos un tipo/)
    expect(screen.queryByRole("button", { name: "Cargar orden de práctica" })).not.toBeInTheDocument()
  })

  it("still offers Atrás when the org has no active tipo", () => {
    const onAtras = vi.fn()
    render(<Harness tipos={[]} onAtras={onAtras} />)

    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }))

    expect(onAtras).toHaveBeenCalledTimes(1)
  })

  it("shows the server message with Reintentar when a 409 re-read finds no practice", async () => {
    routeFetch(mockFetch, {
      [CREAR]: [json({ error: "Ya hay una práctica en curso" }, 409), json({ practica: practica() }, 201)],
      [LEER]: [json({ practica: null })],
    })
    render(<Harness />)
    cargarFormulario()
    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay una práctica en curso")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    expect(await screen.findByRole("heading", { name: "Ahora, la reparación" })).toBeInTheDocument()
    expect(callsTo(mockFetch, "POST", PRACTICA_URL)).toHaveLength(2)
  })
})

describe("PracticaStep — reparar", () => {
  it("requires an amount greater than zero and reads es-AR thousands", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) })],
    })
    render(<Harness inicial={practica()} />)
    const boton = screen.getByRole("button", { name: "Marcar como reparada" })
    const monto = screen.getByLabelText("¿Cuánto cobrarías?")

    expect(boton).toBeDisabled()
    fireEvent.change(monto, { target: { value: "0" } })
    expect(screen.getByText("Poné un monto mayor a cero.")).toBeInTheDocument()
    expect(monto).toHaveAttribute("aria-invalid", "true")
    expect(boton).toBeDisabled()

    fireEvent.change(monto, { target: { value: "15.000" } })
    fireEvent.click(boton)

    expect(await screen.findByRole("heading", { name: "Última parada: la entrega" })).toBeInTheDocument()
    expect(bodyOf(callsTo(mockFetch, "PATCH", PRACTICA_URL)[0])).toEqual({ accion: "reparar", costoFinal: 15000 })
  })

  it("explains what is missing for the amount, linked to the button", () => {
    render(<Harness inicial={practica()} />)
    const boton = screen.getByRole("button", { name: "Marcar como reparada" })

    const ayuda = screen.getByText("Ingresá cuánto cobrarías.")
    expect(boton).toHaveAttribute("aria-describedby", ayuda.id)

    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "0" } })
    expect(screen.getByText("Corregí el monto para continuar.")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "500" } })
    expect(boton).toBeEnabled()
    expect(boton).not.toHaveAttribute("aria-describedby")
    expect(screen.queryByText(/Corregí el monto|Ingresá cuánto/)).not.toBeInTheDocument()
  })

  it("reads decimals written with a comma", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 1500.5 }) })],
    })
    render(<Harness inicial={practica()} />)

    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "1500,50" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    await screen.findByRole("heading", { name: "Última parada: la entrega" })
    expect(bodyOf(callsTo(mockFetch, "PATCH", PRACTICA_URL)[0])).toEqual({ accion: "reparar", costoFinal: 1500.5 })
  })

  it("retries after a network failure", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [new TypeError("network down"), json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) })],
    })
    render(<Harness inicial={practica()} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos conectarnos")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    expect(await screen.findByRole("heading", { name: "Última parada: la entrega" })).toBeInTheDocument()
  })

  it("continues from the real state when the practice was advanced elsewhere (409)", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ error: "La práctica no está en ese paso" }, 409)],
      [LEER]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 9000 }) })],
    })
    render(<Harness inicial={practica()} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    expect(await screen.findByRole("heading", { name: "Última parada: la entrega" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("resyncs without an error when a 409 re-read returns a later sub-step", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ error: "La práctica no está en ese paso" }, 409)],
      [LEER]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 9000 }) })],
    })
    const onChange = vi.fn()
    render(<Harness inicial={practica()} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    await screen.findByRole("heading", { name: "Última parada: la entrega" })
    expect(onChange).toHaveBeenCalledWith(practica({ estado: "REPARADO", costoFinal: 9000 }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("starts over when the practice was deleted (404)", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ error: "No hay práctica" }, 404)],
      [LEER]: [json({ practica: null })],
    })
    render(<Harness inicial={practica()} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    expect(await screen.findByRole("heading", { name: "Cargá tu orden de práctica" })).toBeInTheDocument()
  })
})

describe("PracticaStep — entregar", () => {
  const reparada = practica({ estado: "REPARADO", costoFinal: 15000 })
  const entregada = practica({ estado: "ENTREGADO_SIN_COBRO", costoFinal: 15000 })
  const cobrarias = `Cobrarías ${formatCurrencyValue(15000, "ARS")}`.replace(/\s+/g, " ")

  it("explains that the practice charges nothing, then delivers", async () => {
    routeFetch(mockFetch, { [AVANZAR]: [json({ practica: entregada })] })
    const onChange = vi.fn()
    render(<Harness inicial={reparada} onChange={onChange} />)

    expect(screen.getByText("En la práctica no se cobra nada. En una orden real, acá registrás el pago.")).toBeInTheDocument()
    expect(screen.getByText(cobrarias)).toBeInTheDocument()
    expect(screen.getByText("Le avisamos por email que ya puede pasar a retirar.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Entregar" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(entregada))
    expect(bodyOf(callsTo(mockFetch, "PATCH", PRACTICA_URL)[0])).toEqual({ accion: "entregar" })
  })

  it("retries after a server error", async () => {
    routeFetch(mockFetch, { [AVANZAR]: [json({ error: "Se cayó el envío" }, 500), json({ practica: entregada })] })
    const onChange = vi.fn()
    render(<Harness inicial={reparada} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Se cayó el envío")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(entregada))
  })
})
