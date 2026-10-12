import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { WhatsAppSetup } from "@/components/configuracion/whatsapp-setup"

/**
 * `/api/whatsapp/test` existía sin ninguna pantalla que lo llamara. Sirve para
 * comprobar que lo que sale de STApp llega de verdad al teléfono.
 */
describe("WhatsAppSetup — envío de prueba", () => {
  let testCalls: Array<{ url: string; body: any }>

  const stubFetch = (testResponse: { status: number; json: any }) => {
    testCalls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes("/api/whatsapp/config")) {
          return new Response(JSON.stringify({ isVerified: true, connectionState: "open" }), { status: 200 })
        }
        if (u.includes("/api/whatsapp/test")) {
          testCalls.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) })
          return new Response(JSON.stringify(testResponse.json), { status: testResponse.status })
        }
        return new Response("{}", { status: 200 })
      })
    )
  }

  beforeEach(() => {
    stubFetch({ status: 200, json: { success: true, provider: "evolution", messageId: "msg-1" } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("manda el numero ingresado a /api/whatsapp/test", async () => {
    render(<WhatsAppSetup />)

    const input = await screen.findByLabelText(/Probar el env[ií]o/i)
    fireEvent.change(input, { target: { value: "+54 9 11 2233-4455" } })
    fireEvent.click(screen.getByRole("button", { name: /Enviar prueba/i }))

    await waitFor(() => expect(testCalls).toHaveLength(1))
    expect(testCalls[0].body.phoneNumber).toBe("+54 9 11 2233-4455")
  })

  it("confirma el envio diciendo por que proveedor salio", async () => {
    render(<WhatsAppSetup />)
    fireEvent.change(await screen.findByLabelText(/Probar el env[ií]o/i), { target: { value: "+5491122334455" } })
    fireEvent.click(screen.getByRole("button", { name: /Enviar prueba/i }))

    expect(await screen.findByText(/evolution/i)).toBeInTheDocument()
  })

  it("muestra el motivo que devuelve el server cuando rebota", async () => {
    stubFetch({
      status: 429,
      json: { error: "Límite de mensajes de prueba alcanzado. Máximo 20 por hora por organización.", code: "RATE_LIMITED" },
    })
    render(<WhatsAppSetup />)
    fireEvent.change(await screen.findByLabelText(/Probar el env[ií]o/i), { target: { value: "+5491122334455" } })
    fireEvent.click(screen.getByRole("button", { name: /Enviar prueba/i }))

    expect(await screen.findByText(/Límite de mensajes de prueba alcanzado/i)).toBeInTheDocument()
  })

  it("no llama al server sin numero cargado", async () => {
    render(<WhatsAppSetup />)
    await screen.findByLabelText(/Probar el env[ií]o/i)
    fireEvent.click(screen.getByRole("button", { name: /Enviar prueba/i }))

    await new Promise((r) => setTimeout(r, 50))
    expect(testCalls).toHaveLength(0)
  })

  it("no ofrece la prueba si WhatsApp no esta conectado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isVerified: false, connectionState: "close" }), { status: 200 }))
    )
    render(<WhatsAppSetup />)

    await screen.findByRole("button", { name: /Conectar WhatsApp/i })
    expect(screen.queryByLabelText(/Probar el env[ií]o/i)).not.toBeInTheDocument()
  })
})
