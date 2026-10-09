// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const printHtml = vi.fn()
vi.mock("@/lib/print/print-html-iframe", () => ({ printHtmlViaIframe: (...a: unknown[]) => printHtml(...a) }))
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }))
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

import { LabelsPrintDialog } from "@/components/inventario/labels-print-dialog"
import { resetEtiquetaSizeCache } from "@/components/ordenes/etiqueta-size-org"

const items = [{ id: "1", nombre: "Pantalla", codigo: "ABC123", precioVenta: 1500 }]

describe("LabelsPrintDialog: espera a la configuración del taller", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
    printHtml.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("Imprimir queda deshabilitado hasta que la org responde y usa el tamaño de la org", async () => {
    let soltar: (r: Response) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/api/configuracion/etiqueta-inventario"
          ? new Promise<Response>((r) => (soltar = r))
          : Promise.resolve(new Response(JSON.stringify({ tamano: null }))),
      ),
    )
    render(<LabelsPrintDialog open onOpenChange={() => {}} items={items} />)

    const boton = () => screen.getByRole("button", { name: /Imprimir \(/ }) as HTMLButtonElement
    expect(boton().disabled).toBe(true)
    expect(screen.getByText("Cargando…")).toBeTruthy()

    soltar(new Response(JSON.stringify({ medio: "thermal", tamano: "60x40" })))
    await waitFor(() => expect(boton().disabled).toBe(false))

    fireEvent.click(boton())
    await waitFor(() => expect(printHtml).toHaveBeenCalled())
    expect(String(printHtml.mock.calls[0][0])).toContain("size: 60mm 40mm")
  })
})
