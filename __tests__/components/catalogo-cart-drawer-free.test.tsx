import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import { CartDrawer } from "@/components/catalogo-public/cart-drawer"

const clear = vi.fn()
const onClose = vi.fn()
function makeCart() {
  return {
    items: [
      { id: "i1", nombre: "Funda", precio: 1500, cantidad: 2, stock_disponible: null },
      { id: "i2", nombre: "Celular", precio: 90000, cantidad: 1, stock_disponible: null, varianteId: "v1", varianteEtiqueta: "256GB" },
    ],
    total: 93000,
    count: 3,
    cartKey: (i: { id: string; varianteId?: string | null }) => `${i.id}:${i.varianteId ?? ""}`,
    setCantidad: vi.fn(),
    remove: vi.fn(),
    clear,
  }
}

function renderDrawer(props: { recibePedidos?: boolean; whatsapp?: string | null }) {
  render(
    <CartDrawer
      open
      onClose={onClose}
      cart={makeCart() as never}
      slug="taller"
      titulo="Taller Sur"
      formatPrecio={(n) => `$${n.toLocaleString("es-AR")}`}
      brandColor="#2563eb"
      {...props}
    />
  )
}

describe("CartDrawer — plan sin pedidos online", () => {
  let openSpy: ReturnType<typeof vi.spyOn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clear.mockClear()
    onClose.mockClear()
    vi.mocked(toast.error).mockClear()
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    openSpy.mockRestore()
  })

  it("Free + WhatsApp: abre wa.me con el pedido, sin llamar a /cotizar, y no vacía el carrito hasta confirmar", () => {
    renderDrawer({ recibePedidos: false, whatsapp: "5491112345678" })
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }))
    expect(document.getElementById("telefono")).toBeNull()
    expect(document.getElementById("cupon")).toBeNull()
    fireEvent.change(document.getElementById("nombre") as HTMLElement, { target: { value: "Ana" } })
    fireEvent.click(screen.getByRole("button", { name: /whatsapp/i }))

    expect(openSpy).toHaveBeenCalledTimes(1)
    const url = String(openSpy.mock.calls[0][0])
    expect(url.startsWith("https://wa.me/5491112345678?text=")).toBe(true)
    const texto = decodeURIComponent(url.split("?text=")[1])
    expect(texto).toContain("2× Funda")
    expect(texto).toContain("Celular (256GB)")
    expect(texto).toContain("Total: $93.000")
    expect(texto).toContain("Nombre: Ana")
    expect(fetchMock).not.toHaveBeenCalled()

    // El carrito sigue ahí: window.open con noopener no permite saber si abrió.
    expect(clear).not.toHaveBeenCalled()
    const reabrir = screen.getByRole("link", { name: /volver a abrir whatsapp/i })
    expect(reabrir).toHaveAttribute("href", url)
    expect(reabrir).toHaveAttribute("target", "_blank")
    expect(reabrir.getAttribute("rel")).toContain("noopener")

    fireEvent.click(screen.getByRole("button", { name: /ya lo envié/i }))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it("403 FEATURE_REQUIRED sin WhatsApp del taller: el aviso no manda a enviar a ningún lado", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "x", code: "FEATURE_REQUIRED" }) })
    renderDrawer({ recibePedidos: true, whatsapp: null })
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }))
    fireEvent.change(document.getElementById("nombre") as HTMLElement, { target: { value: "Ana" } })
    fireEvent.change(document.getElementById("telefono") as HTMLElement, { target: { value: "1122334455" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /enviar solicitud/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const msg = String(vi.mocked(toast.error).mock.calls[0][0])
    expect(msg).toMatch(/no está tomando pedidos/i)
    expect(msg).not.toMatch(/envialo/i)
    expect(clear).not.toHaveBeenCalled()
  })

  it("Free sin WhatsApp: no deja continuar y explica por qué", () => {
    renderDrawer({ recibePedidos: false, whatsapp: null })
    expect(screen.getByText(/no está tomando pedidos online/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled()
  })

  it("plan con pedidos: sigue llamando a /cotizar", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: "/cotizacion/t", whatsappTallerUrl: null }) })
    renderDrawer({ recibePedidos: true, whatsapp: "5491112345678" })
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }))
    fireEvent.change(document.getElementById("nombre") as HTMLElement, { target: { value: "Ana" } })
    fireEvent.change(document.getElementById("telefono") as HTMLElement, { target: { value: "1122334455" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /enviar solicitud/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("/cotizar")
  })

  it("403 FEATURE_REQUIRED: pasa a modo WhatsApp en vez de mostrar un error genérico", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "x", code: "FEATURE_REQUIRED" }) })
    renderDrawer({ recibePedidos: true, whatsapp: "5491112345678" })
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }))
    fireEvent.change(document.getElementById("nombre") as HTMLElement, { target: { value: "Ana" } })
    fireEvent.change(document.getElementById("telefono") as HTMLElement, { target: { value: "1122334455" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /enviar solicitud/i }))
    expect(await screen.findByRole("button", { name: /whatsapp/i })).toBeInTheDocument()
    expect(clear).not.toHaveBeenCalled()
  })

  it("429: muestra el mensaje del servidor como aviso en el drawer, sin vaciar el carrito ni error genérico", async () => {
    const msg = "Ya tenés pedidos pendientes con este teléfono. El taller se va a comunicar con vos."
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: msg, code: "OPEN_ORDERS_LIMIT" }) })
    renderDrawer({ recibePedidos: true, whatsapp: "5491112345678" })
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }))
    fireEvent.change(document.getElementById("nombre") as HTMLElement, { target: { value: "Ana" } })
    fireEvent.change(document.getElementById("telefono") as HTMLElement, { target: { value: "1122334455" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /enviar solicitud/i }))
    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(msg)
    expect(toast.error).not.toHaveBeenCalledWith("Error al enviar")
    expect(clear).not.toHaveBeenCalled()
  })
})
