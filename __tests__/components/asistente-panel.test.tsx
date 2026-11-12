/**
 * Panel del asistente: sugerencias del servidor, respuesta en streaming con formato, etiqueta de
 * la herramienta mientras consulta, reintentar, tope diario, conversación restaurada y Enter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { AsistentePanel } from "@/components/asistente/asistente-panel"

const enc = new TextEncoder()

/** Una respuesta NDJSON que el test va alimentando. */
function streamControlado() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) })
  return {
    respuesta: { ok: true, status: 200, headers: { get: () => "application/x-ndjson" }, body, json: async () => ({}) },
    enviar: (e: object) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")),
    cerrar: () => ctrl.close(),
  }
}
function streamCompleto(...eventos: object[]) {
  const s = streamControlado()
  for (const e of eventos) s.enviar(e)
  s.cerrar()
  return s.respuesta
}
const json = (status: number, data: object) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, body: null, json: async () => data })

let postRespuestas: unknown[]
let getRespuesta: object
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  postRespuestas = []
  getRespuesta = { sugerencias: ["¿Qué órdenes están atrasadas?"], restantes: 40, limiteDiario: 50, conversacion: null }
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method !== "POST") return json(200, getRespuesta)
    return postRespuestas.shift() ?? json(500, { error: "sin respuesta" })
  })
  vi.stubGlobal("fetch", fetchMock)
  window.localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
const abrir = () => render(<AsistentePanel open onClose={() => {}} />)

describe("AsistentePanel", () => {
  it("muestra las sugerencias del servidor y arma la respuesta en streaming, con formato", async () => {
    postRespuestas.push(
      streamCompleto(
        { tipo: "conversacion", conversacionId: "conv-1" },
        { tipo: "texto", delta: "Tenés 2:\n- CEL-1" },
        { tipo: "texto", delta: "\n- CEL-2" },
        { tipo: "fin", texto: "Tenés 2:\n- CEL-1\n- CEL-2", conversacionId: "conv-1", restantes: 39 }
      )
    )
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "¿Qué órdenes están atrasadas?" }))

    expect(await screen.findByText("CEL-2")).toBeInTheDocument()
    expect(screen.getByText("CEL-1").tagName).toBe("LI")
    expect(screen.getByRole("button", { name: "Copiar respuesta" })).toBeInTheDocument()
    expect(JSON.parse(posts()[0][1].body as string)).toEqual({ message: "¿Qué órdenes están atrasadas?", conversacionId: null })
    expect(posts()[0][1].headers).toMatchObject({ accept: "application/x-ndjson" })
    // La conversación queda guardada para restaurarla al recargar.
    expect(window.localStorage.getItem("stapp:asistente:conversacion")).toBe("conv-1")
  })

  it("mientras consulta muestra qué está buscando", async () => {
    const s = streamControlado()
    postRespuestas.push(s.respuesta)
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "¿Qué órdenes están atrasadas?" }))
    await act(async () => s.enviar({ tipo: "herramienta", nombre: "buscar_ordenes", etiqueta: "Buscando órdenes…" }))
    expect(await screen.findByText("Buscando órdenes…")).toBeInTheDocument()
    await act(async () => {
      s.enviar({ tipo: "fin", texto: "Ninguna atrasada.", conversacionId: "c", restantes: 39 })
      s.cerrar()
    })
    // Aparece en la burbuja y en el anuncio para lectores de pantalla.
    expect(await screen.findAllByText("Ninguna atrasada.")).toHaveLength(2)
    expect(screen.queryByText("Buscando órdenes…")).not.toBeInTheDocument()
  })

  it("un error se puede reintentar sin duplicar la pregunta", async () => {
    postRespuestas.push(json(502, { error: "El asistente está teniendo problemas.", code: "UPSTREAM_ERROR" }))
    postRespuestas.push(streamCompleto({ tipo: "fin", texto: "Ahora sí.", conversacionId: "c", restantes: 39 }))
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "¿Qué órdenes están atrasadas?" }))
    fireEvent.click(await screen.findByRole("button", { name: /Reintentar/ }))

    expect(await screen.findAllByText("Ahora sí.")).toHaveLength(2)
    expect(screen.queryByText("El asistente está teniendo problemas.")).not.toBeInTheDocument()
    expect(screen.getAllByText("¿Qué órdenes están atrasadas?")).toHaveLength(1)
    expect(posts()).toHaveLength(2)
  })

  it("el tope diario no ofrece reintentar y bloquea el campo", async () => {
    postRespuestas.push(json(429, { error: "Alcanzaste el límite diario del asistente.", code: "DAILY_LIMIT", restantes: 0 }))
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "¿Qué órdenes están atrasadas?" }))
    expect(await screen.findByText("Alcanzaste el límite diario del asistente.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Escribí tu pregunta")).toBeDisabled()
    expect(screen.getByText(/Se terminaron las consultas de hoy/)).toBeInTheDocument()
  })

  it("avisa cuando quedan pocas consultas", async () => {
    getRespuesta = { ...getRespuesta, restantes: 3 }
    abrir()
    expect(await screen.findByText("Quedan 3 consultas hoy para tu taller.")).toBeInTheDocument()
  })

  it("restaura la conversación guardada en este navegador", async () => {
    window.localStorage.setItem("stapp:asistente:conversacion", "conv-9")
    getRespuesta = {
      ...getRespuesta,
      conversacion: { id: "conv-9", mensajes: [{ id: "a", tipo: "USER", contenido: "¿y la 12?" }, { id: "b", tipo: "ASSISTANT", contenido: "Está **reparada**." }] },
    }
    abrir()
    expect(await screen.findByText("reparada")).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/asistente?conversacionId=conv-9")
  })

  it("Enter envía y Shift+Enter no", async () => {
    postRespuestas.push(streamCompleto({ tipo: "fin", texto: "ok", conversacionId: "c", restantes: 39 }))
    abrir()
    const campo = screen.getByLabelText("Escribí tu pregunta")
    fireEvent.change(campo, { target: { value: "hola" } })
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true })
    expect(posts()).toHaveLength(0)
    fireEvent.keyDown(campo, { key: "Enter" })
    await waitFor(() => expect(posts()).toHaveLength(1))
  })
})
