import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react"
import React, { useEffect, useState } from "react"

// next/dynamic: carga el módulo real de forma asíncrona (como en el navegador).
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<any> }>) =>
    function Dynamic(props: any) {
      const [Comp, setComp] = useState<React.ComponentType<any> | null>(null)
      useEffect(() => {
        let vivo = true
        loader().then((m) => { if (vivo) setComp(() => m.default) })
        return () => { vivo = false }
      }, [])
      return Comp ? <Comp {...props} /> : null
    },
}))

// Se captura el callback de polling para dispararlo a mano.
let pollCallback: (() => void) | null = null
vi.mock("@/hooks/use-visibility-polling", () => ({
  useVisibilityPolling: (cb: () => void, _ms: number, enabled: boolean) => {
    pollCallback = enabled ? cb : null
  },
}))

import { SeguimientoContent } from "@/components/seguimiento/seguimiento-content"

const ordenBase = {
  id: "o1",
  numeroOrden: 7,
  codigoOrden: "ORD-0007",
  dispositivo: "Samsung A52",
  tipoDispositivo: "CELULAR",
  estado: "EN_REPARACION",
  problemaReportado: "No carga",
  fechaIngreso: "2026-11-01T10:00:00Z",
  cliente: { nombre: "Ana" },
  organizacion: { nombre: "Taller Centro" },
}

const timelinePayload = {
  timeline: [
    { id: "e1", type: "evento", eventType: "CAMBIO_ESTADO", estadoNuevo: "RECIBIDO", createdAt: "2026-11-01T10:00:00Z" },
    { id: "e2", type: "evento", eventType: "CAMBIO_ESTADO", estadoNuevo: "SIN_FALLA_DETECTADA", createdAt: "2026-11-02T10:00:00Z" },
  ],
}

type Respuesta = { status: number; body?: unknown } | "network"

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
}

let ordenRespuestas: Respuesta[] = []
const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input)
  if (url.endsWith("/timeline")) return jsonResponse(200, timelinePayload)
  if (url.endsWith("/photos")) return jsonResponse(200, { INGRESO: [], REPARACION: [], ENTREGA: [] })
  if (url.endsWith("/warranty")) return jsonResponse(200, { garantia: null })
  if (url.endsWith("/danos")) return jsonResponse(200, { danos: [], sinDanos: false, diagrama: "celular" })
  const r = ordenRespuestas.length > 1 ? ordenRespuestas.shift()! : ordenRespuestas[0]
  if (r === "network") return Promise.reject(new TypeError("Failed to fetch"))
  return jsonResponse(r.status, r.body ?? {})
})

function llamadas(sufijo: string) {
  return fetchMock.mock.calls.filter(([u]) => String(u).endsWith(sufijo)).length
}

async function poll() {
  await act(async () => { pollCallback?.() })
}

describe("SeguimientoContent", () => {
  beforeEach(() => {
    pollCallback = null
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("renderiza la línea de tiempo desde { timeline } con textos para el cliente", async () => {
    ordenRespuestas = [{ status: 200, body: ordenBase }]
    render(<SeguimientoContent token="tok" />)

    expect(await screen.findByText("Ingresó al taller")).toBeInTheDocument()
    expect(screen.getByText("Lo revisamos y no detectamos la falla reportada")).toBeInTheDocument()
    expect(screen.queryByText(/Estado cambiado de/)).not.toBeInTheDocument()
  })

  it("si un poll falla mantiene los datos, avisa discreto y se recupera", async () => {
    ordenRespuestas = [{ status: 200, body: ordenBase }, "network", { status: 500 }, { status: 200, body: ordenBase }]
    render(<SeguimientoContent token="tok" />)
    expect(await screen.findByText("ORD-0007")).toBeInTheDocument()

    await poll()
    expect(await screen.findByText(/Sin conexión, reintentando/)).toBeInTheDocument()
    expect(screen.getByText("ORD-0007")).toBeInTheDocument()
    expect(screen.queryByText("Orden no encontrada")).not.toBeInTheDocument()

    await poll()
    expect(screen.getByText("ORD-0007")).toBeInTheDocument()

    await poll()
    await waitFor(() => expect(screen.queryByText(/Sin conexión, reintentando/)).not.toBeInTheDocument())
    expect(screen.getByText("ORD-0007")).toBeInTheDocument()
  })

  it("no vuelve a pedir timeline/fotos/garantía en cada poll, sólo si cambia el estado", async () => {
    ordenRespuestas = [
      { status: 200, body: ordenBase },
      { status: 200, body: ordenBase },
      { status: 200, body: { ...ordenBase, estado: "REPARADO" } },
    ]
    render(<SeguimientoContent token="tok" />)
    expect(await screen.findByText("ORD-0007")).toBeInTheDocument()
    await waitFor(() => expect(llamadas("/photos")).toBe(1))

    await poll()
    await waitFor(() => expect(llamadas("/tok")).toBe(2))
    expect(llamadas("/timeline")).toBe(1)
    expect(llamadas("/photos")).toBe(1)
    expect(llamadas("/warranty")).toBe(1)

    await poll()
    await waitFor(() => expect(llamadas("/photos")).toBe(2))
    expect(llamadas("/timeline")).toBe(2)
    expect(llamadas("/warranty")).toBe(2)
  })

  it("con 404 en la carga inicial muestra 'Orden no encontrada'", async () => {
    ordenRespuestas = [{ status: 404, body: { error: "Orden no encontrada" } }]
    render(<SeguimientoContent token="tok" />)
    expect(await screen.findByText("Orden no encontrada")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Reintentar/ })).not.toBeInTheDocument()
  })

  it("con error de red en la carga inicial ofrece reintentar", async () => {
    ordenRespuestas = [{ status: 503 }, { status: 200, body: ordenBase }]
    render(<SeguimientoContent token="tok" />)
    expect(await screen.findByText("No pudimos cargar tu orden")).toBeInTheDocument()
    expect(screen.queryByText("Orden no encontrada")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(await screen.findByText("ORD-0007")).toBeInTheDocument()
  })
})
