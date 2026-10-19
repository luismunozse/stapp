// __tests__/components/comprobante-fiscal-card.test.tsx
/**
 * Bloque fiscal de la ficha de venta: estados none / pendiente / emitido /
 * rechazado, elegibilidad para emitir y emision con proteccion de doble click.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"
import { ComprobanteFiscalCard } from "@/components/ventas/comprobante-fiscal-card"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

type Item = Record<string, unknown>

function item(over: Item = {}): Item {
  return {
    id: "c1",
    ventaId: "v1",
    numeroVenta: 5,
    tipo: "B",
    puntoVenta: 1,
    numero: "0001-00000007",
    cae: "74123456789012",
    caeVencimiento: "20261029",
    estado: "emitido",
    total: 1210,
    errorMsg: null,
    pdfUrl: null,
    fechaEmision: "2026-10-19",
    createdAt: "2026-10-19T15:00:00Z",
    pdfDisponible: true,
    ...over,
  }
}

function listado(items: Item[], puedeEmitir = true) {
  return { items, total: items.length, page: 1, limit: 1, totalPages: 1, puedeEmitir }
}

/** Responde por URL: el listado con las respuestas en cola y el emitir con `emitir`. */
function montarFetch(listados: unknown[], emitir?: { status: number; body: unknown }) {
  const cola = [...listados]
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/facturacion-electronica/emitir")) {
      return { status: emitir!.status, ok: emitir!.status === 200, json: async () => emitir!.body }
    }
    const body = cola.length > 1 ? cola.shift() : cola[0]
    return { status: 200, ok: true, json: async () => body }
  })
}

const elegible = { estadoVenta: "COMPLETADA", tieneDevoluciones: false }

function renderCard(props: Partial<React.ComponentProps<typeof ComprobanteFiscalCard>> = {}) {
  return render(<ComprobanteFiscalCard ventaId="v1" {...elegible} {...props} />)
}

describe("ComprobanteFiscalCard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("pide solo el ultimo comprobante de la venta", async () => {
    montarFetch([listado([item()])])
    renderCard()
    await screen.findByText(/74123456789012/)
    expect(mockFetch).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes?ventaId=v1&limit=1")
  })

  describe("sin comprobante", () => {
    it("ofrece 'Emitir factura electrónica' si se puede emitir", async () => {
      montarFetch([listado([], true)])
      renderCard()
      expect(await screen.findByRole("button", { name: /Emitir factura electrónica/i })).toBeEnabled()
    })

    it("no muestra nada si no se puede emitir", async () => {
      montarFetch([listado([], false)])
      const { container } = renderCard()
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      await waitFor(() => expect(container).toBeEmptyDOMElement())
    })

    it("no ofrece emitir en una venta anulada", async () => {
      montarFetch([listado([], true)])
      const { container } = renderCard({ estadoVenta: "ANULADA" })
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      await waitFor(() => expect(container).toBeEmptyDOMElement())
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
    })

    it("no ofrece emitir si la venta tiene devoluciones", async () => {
      montarFetch([listado([], true)])
      const { container } = renderCard({ tieneDevoluciones: true })
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      await waitFor(() => expect(container).toBeEmptyDOMElement())
    })

    it("si el listado falla no muestra nada ni rompe", async () => {
      mockFetch.mockRejectedValue(new Error("offline"))
      const { container } = renderCard()
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      await waitFor(() => expect(container).toBeEmptyDOMElement())
    })
  })

  describe("emision", () => {
    it("emite, muestra la factura y saca el boton", async () => {
      montarFetch(
        [listado([], true), listado([item()], true)],
        { status: 200, body: { comprobante: { id: "c1", tipo: "B", numero: "0001-00000007" } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: /Emitir factura electrónica/i }))

      expect(await screen.findByText(/74123456789012/)).toBeInTheDocument()
      expect(screen.getByText(/0001-00000007/)).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Emitir factura electrónica/i })).not.toBeInTheDocument()
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion-electronica/emitir",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ ventaId: "v1" }) })
      )
    })

    it("deshabilita el boton mientras emite: un segundo click no dispara otra emision", async () => {
      let liberar!: () => void
      const espera = new Promise<void>((r) => (liberar = r))
      let emisiones = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/facturacion-electronica/emitir")) {
          emisiones++
          await espera
          return { status: 200, json: async () => ({ comprobante: { id: "c1" } }) }
        }
        return { status: 200, ok: true, json: async () => listado([], true) }
      })
      renderCard()
      const boton = await screen.findByRole("button", { name: /Emitir factura electrónica/i })
      fireEvent.click(boton)
      await waitFor(() => expect(screen.getByRole("button", { name: /Emitiendo/i })).toBeDisabled())
      fireEvent.click(screen.getByRole("button", { name: /Emitiendo/i }))
      liberar()
      await waitFor(() => expect(emisiones).toBe(1))
    })

    it("422: muestra el mensaje y deja reintentar", async () => {
      montarFetch([listado([], true)], { status: 422, body: { comprobante: { error_msg: "CUIT inválido" } } })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: /Emitir factura electrónica/i }))
      expect(await screen.findByText("CUIT inválido")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Emitir factura electrónica/i })).toBeEnabled()
    })

    it("409: otra pantalla ya emitio, se muestra el comprobante existente", async () => {
      montarFetch(
        [listado([], true), listado([item()], true)],
        { status: 409, body: { comprobante: { id: "c1" }, error: "Esta venta ya tiene un comprobante" } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: /Emitir factura electrónica/i }))
      expect(await screen.findByText(/74123456789012/)).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Emitir factura electrónica/i })).not.toBeInTheDocument()
    })
  })

  describe("emitido", () => {
    it("muestra tipo, numero, CAE y vencimiento con link a Ver PDF", async () => {
      montarFetch([listado([item()], true)])
      renderCard()
      expect(await screen.findByText(/Factura B 0001-00000007/)).toBeInTheDocument()
      expect(screen.getByText("74123456789012")).toBeInTheDocument()
      expect(screen.getByText("29/10/2026")).toBeInTheDocument()
      const link = screen.getByRole("link", { name: /Ver PDF/i })
      expect(link).toHaveAttribute("href", "/api/facturacion-electronica/comprobantes/c1/pdf")
      expect(link).toHaveAttribute("target", "_blank")
    })

    it("sin foto fiscal: avisa 'datos incompletos' y no ofrece el PDF", async () => {
      montarFetch([listado([item({ pdfDisponible: false })], true)])
      renderCard()
      expect(await screen.findByText(/datos incompletos/i)).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: /Ver PDF/i })).not.toBeInTheDocument()
    })

    it("no se ofrece emitir de nuevo aunque se pueda emitir", async () => {
      montarFetch([listado([item()], true)])
      renderCard()
      await screen.findByText(/74123456789012/)
      expect(screen.queryByRole("button", { name: /Emitir|Reintentar/i })).not.toBeInTheDocument()
    })
  })

  describe("pendiente", () => {
    it("muestra que esta en proceso, sin botones", async () => {
      montarFetch([listado([item({ estado: "pendiente", cae: null, caeVencimiento: null, numero: null, pdfDisponible: false })], true)])
      renderCard()
      expect(await screen.findByText(/En proceso/)).toBeInTheDocument()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
    })
  })

  describe("rechazado", () => {
    const rechazado = item({ estado: "rechazado", cae: null, caeVencimiento: null, numero: null, errorMsg: "Receptor sin CUIT válido", pdfDisponible: false })

    it("muestra el motivo y 'Reintentar'", async () => {
      montarFetch([listado([rechazado], true)])
      renderCard()
      expect(await screen.findByText("Receptor sin CUIT válido")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Reintentar/i })).toBeEnabled()
    })

    it("Reintentar usa el mismo endpoint y reemplaza el bloque con lo emitido", async () => {
      montarFetch(
        [listado([rechazado], true), listado([item()], true)],
        { status: 200, body: { comprobante: { id: "c2" } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: /Reintentar/i }))
      expect(await screen.findByText(/74123456789012/)).toBeInTheDocument()
      expect(screen.queryByText("Receptor sin CUIT válido")).not.toBeInTheDocument()
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion-electronica/emitir",
        expect.objectContaining({ body: JSON.stringify({ ventaId: "v1" }) })
      )
    })

    it("sin permiso para emitir muestra el motivo pero no 'Reintentar'", async () => {
      montarFetch([listado([rechazado], false)])
      renderCard()
      expect(await screen.findByText("Receptor sin CUIT válido")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Reintentar/i })).not.toBeInTheDocument()
    })

    it("en una venta con devoluciones no se reintenta", async () => {
      montarFetch([listado([rechazado], true)])
      renderCard({ tieneDevoluciones: true })
      expect(await screen.findByText("Receptor sin CUIT válido")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Reintentar/i })).not.toBeInTheDocument()
    })
  })
})
