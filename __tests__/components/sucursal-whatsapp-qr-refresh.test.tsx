import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { SucursalWhatsAppCard } from "@/components/configuracion/sucursal-whatsapp-card"

/** Mismo bug del QR congelado que en el WhatsApp de la organización. */
describe("SucursalWhatsAppCard — el QR mostrado sigue las rotaciones del server", () => {
  let qrEntregados: string[]

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    qrEntregados = ["data:image/png;base64,SUC-1", "data:image/png;base64,SUC-2", "data:image/png;base64,SUC-3"]

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes("/whatsapp/connect") && init?.method === "POST") {
          return new Response(JSON.stringify({ state: "qr", qrBase64: qrEntregados.shift() }), { status: 200 })
        }
        if (u.includes("/whatsapp/qr")) {
          const conRefresh = u.includes("refresh=1")
          return new Response(
            JSON.stringify({ state: "connecting", qrBase64: conRefresh ? qrEntregados.shift() ?? null : null }),
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
    render(<SucursalWhatsAppCard sucursalId="suc-1" />)

    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/i }))

    const inicial = await screen.findByAltText("QR de WhatsApp")
    expect(inicial).toHaveAttribute("src", "data:image/png;base64,SUC-1")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    await waitFor(() => {
      expect(screen.getByAltText("QR de WhatsApp")).toHaveAttribute("src", "data:image/png;base64,SUC-2")
    })
  })

  it("pide QR nuevo al server, no solo el estado", async () => {
    render(<SucursalWhatsAppCard sucursalId="suc-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/i }))
    await screen.findByAltText("QR de WhatsApp")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes("/whatsapp/qr") && u.includes("refresh=1"))).toBe(true)
  })
})
