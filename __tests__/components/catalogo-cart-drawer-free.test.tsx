import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CartDrawer } from "@/components/catalogo-public/cart-drawer"

const clear = vi.fn()
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
      onClose={vi.fn()}
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
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    openSpy.mockRestore()
  })

  it("Free + WhatsApp: abre wa.me con el pedido, sin llamar a /cotizar, y vacía el carrito", () => {
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
    expect(clear).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
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
})
