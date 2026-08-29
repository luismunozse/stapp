import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { WhatsAppSetup } from "@/components/configuracion/whatsapp-setup"

/**
 * Los QR de Baileys expiran en segundos y Evolution los rota. La pantalla tiene
 * que ir a buscar el vigente; el bug original mostraba el primero congelado 90s,
 * asi que el taller escaneaba un codigo muerto y la vinculacion nunca ocurria.
 */
describe("WhatsAppSetup — el QR mostrado sigue las rotaciones del server", () => {
  let qrEntregados: string[]

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    qrEntregados = ["data:image/png;base64,QR-1", "data:image/png;base64,QR-2", "data:image/png;base64,QR-3"]

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes("/api/whatsapp/config")) {
          return new Response(JSON.stringify({ isVerified: false, connectionState: "close" }), { status: 200 })
        }
        if (u.includes("/api/whatsapp/evolution/connect") && init?.method === "POST") {
          return new Response(JSON.stringify({ state: "qr", qrBase64: qrEntregados.shift(), pairingCode: null }), { status: 200 })
        }
        if (u.includes("/api/whatsapp/evolution/qr")) {
          const conRefresh = u.includes("refresh=1")
          return new Response(
            JSON.stringify({
              state: "connecting",
              qrBase64: conRefresh ? qrEntregados.shift() ?? null : null,
              pairingCode: null,
            }),
            { status: 200 }
          )
        }
        return new Response("{}", { status: 200 })
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("reemplaza el QR vencido por el que rota el server", async () => {
    render(<WhatsAppSetup />)

    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/i }))

    const qrInicial = await screen.findByAltText("QR de WhatsApp")
    expect(qrInicial).toHaveAttribute("src", "data:image/png;base64,QR-1")

    // Pasado el tiempo de vida del QR, el mostrado ya no puede ser el primero.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    await waitFor(() => {
      expect(screen.getByAltText("QR de WhatsApp")).toHaveAttribute("src", "data:image/png;base64,QR-2")
    })
  })

  it("pide QR nuevo al server, no solo el estado", async () => {
    render(<WhatsAppSetup />)
    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/i }))
    await screen.findByAltText("QR de WhatsApp")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes("/api/whatsapp/evolution/qr") && u.includes("refresh=1"))).toBe(true)
  })

  it("no abandona mientras el usuario sigue teniendo un QR valido para escanear", async () => {
    render(<WhatsAppSetup />)
    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/i }))
    await screen.findByAltText("QR de WhatsApp")

    // El corte a los 90s dejaba al taller sin nada mientras seguia intentando.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000)
    })

    expect(screen.queryByText(/Tiempo agotado/i)).not.toBeInTheDocument()
    expect(screen.getByAltText("QR de WhatsApp")).toBeInTheDocument()
  })
})
