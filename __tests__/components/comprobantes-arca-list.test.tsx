// __tests__/components/comprobantes-arca-list.test.tsx
/**
 * Listado "Comprobantes ARCA" de /facturacion: filas, filtro por estado (con el
 * valor "todos", nunca vacio), paginacion, estados vacio y de error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import React, { type ReactNode } from "react"
import { ComprobantesArcaList } from "@/components/facturacion/comprobantes-arca-list"

// Select nativo-like: Radix lanza si un SelectItem tiene value "" (gotcha del eco vacio).
vi.mock("@/components/ui/select", async () => {
  const React = await import("react")
  const Contexto = React.createContext<{ onValueChange?: (v: string) => void }>({})
  return {
    Select: ({ onValueChange, children }: { onValueChange?: (v: string) => void; children: ReactNode }) => (
      <Contexto.Provider value={{ onValueChange }}>{children}</Contexto.Provider>
    ),
    SelectTrigger: ({ children, ...props }: Record<string, unknown> & { children: ReactNode }) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: ReactNode }) => <div role="listbox">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      if (value === "") throw new Error("A <Select.Item /> must have a value prop that is not an empty string")
      const { onValueChange } = React.useContext(Contexto)
      return (
        <button type="button" role="option" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    },
  }
})

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

type Item = Record<string, unknown>

function fila(over: Item = {}): Item {
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
    cbteTipo: 6,
    esNotaCredito: false,
    comprobanteAsociadoId: null,
    anuladoAt: null,
    motivo: null,
    motivoDetalle: null,
    anulable: true,
    verificable: false,
    ...over,
  }
}

/** Nota de credito electronica B (cbte_tipo 8) asociada a una factura. */
function notaCredito(over: Item = {}): Item {
  return fila({
    id: "nc1",
    numero: "0001-00000002",
    cae: "74123456780002",
    cbteTipo: 8,
    esNotaCredito: true,
    comprobanteAsociadoId: "c1",
    motivo: "error_factura",
    anulable: false,
    ...over,
  })
}

function pagina(items: Item[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1, puedeEmitir: true, ...extra }
}

function responder(...paginas: unknown[]) {
  const cola = [...paginas]
  mockFetch.mockImplementation(async () => {
    const body = cola.length > 1 ? cola.shift() : cola[0]
    return { ok: true, status: 200, json: async () => body }
  })
}

const urls = () => mockFetch.mock.calls.map((c) => String(c[0]))

describe("ComprobantesArcaList", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lista los comprobantes: numero, tipo, venta, total, estado, CAE", async () => {
    responder(pagina([fila()]))
    render(<ComprobantesArcaList />)

    expect(await screen.findByText("0001-00000007")).toBeInTheDocument()
    expect(screen.getByText("19/10/2026")).toBeInTheDocument()
    expect(screen.getByText("Emitida")).toBeInTheDocument()
    expect(screen.getByText("74123456789012")).toBeInTheDocument()
    expect(screen.getByText(/1\.210/)).toBeInTheDocument()
    const ventaLink = screen.getByRole("link", { name: "V0005" })
    expect(ventaLink).toHaveAttribute("href", "/ventas/v1")
    expect(urls()[0]).toBe("/api/facturacion-electronica/comprobantes?page=1&limit=20")
  })

  it("emitido con PDF: link 'Ver PDF' en pestaña nueva", async () => {
    responder(pagina([fila()]))
    render(<ComprobantesArcaList />)
    const link = await screen.findByRole("link", { name: /Ver PDF/i })
    expect(link).toHaveAttribute("href", "/api/facturacion-electronica/comprobantes/c1/pdf")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("emitido sin foto fiscal: 'datos incompletos' en vez de PDF", async () => {
    responder(pagina([fila({ pdfDisponible: false })]))
    render(<ComprobantesArcaList />)
    expect(await screen.findByText(/datos incompletos/i)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Ver PDF/i })).not.toBeInTheDocument()
  })

  it("rechazado: muestra el motivo y no ofrece PDF", async () => {
    responder(pagina([fila({ estado: "rechazado", numero: null, cae: null, errorMsg: "CUIT inválido", pdfDisponible: false })]))
    render(<ComprobantesArcaList />)
    expect(await screen.findByText("Rechazada")).toBeInTheDocument()
    expect(screen.getByText("CUIT inválido")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Ver PDF/i })).not.toBeInTheDocument()
  })

  it("una venta borrada o sin numero no rompe la fila", async () => {
    responder(pagina([fila({ ventaId: null, numeroVenta: null })]))
    render(<ComprobantesArcaList />)
    await screen.findByText("0001-00000007")
    expect(screen.queryByRole("link", { name: /^V\d+/ })).not.toBeInTheDocument()
  })

  describe("filtro por estado", () => {
    it("elegir 'Rechazadas' pide estado=rechazado desde la pagina 1", async () => {
      responder(pagina([fila()]), pagina([fila({ id: "c2", estado: "rechazado", errorMsg: "x", numero: null })]))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000007")
      fireEvent.click(screen.getByRole("option", { name: "Rechazadas" }))
      await waitFor(() => expect(urls()).toContain("/api/facturacion-electronica/comprobantes?page=1&limit=20&estado=rechazado"))
    })

    it("volver a 'Todos los estados' (valor 'todos') saca el filtro", async () => {
      responder(pagina([fila()]))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000007")
      fireEvent.click(screen.getByRole("option", { name: "Emitidas" }))
      await waitFor(() => expect(urls().some((u) => u.includes("estado=emitido"))).toBe(true))
      const antes = urls().length
      fireEvent.click(screen.getByRole("option", { name: "Todos los estados" }))
      await waitFor(() => expect(urls().length).toBeGreaterThan(antes))
      expect(urls().at(-1)).toBe("/api/facturacion-electronica/comprobantes?page=1&limit=20")
    })
  })

  describe("notas de credito y facturas anuladas", () => {
    it("el filtro ofrece 'Anuladas' y pide estado=anulado desde la pagina 1", async () => {
      responder(pagina([fila()]), pagina([fila({ estado: "anulado", anuladoAt: "2026-10-20T13:00:00Z", anulable: false })]))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000007")
      fireEvent.click(screen.getByRole("option", { name: "Anuladas" }))
      await waitFor(() => expect(urls()).toContain("/api/facturacion-electronica/comprobantes?page=1&limit=20&estado=anulado"))
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
    })

    it("una factura anulada muestra la insignia 'Anulada' y conserva su PDF", async () => {
      responder(pagina([fila({ estado: "anulado", anulable: false })]))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
      expect(screen.queryByText("Emitida")).not.toBeInTheDocument()
      const link = screen.getByRole("link", { name: /Ver PDF/i })
      expect(link).toHaveAttribute("href", "/api/facturacion-electronica/comprobantes/c1/pdf")
      expect(link).toHaveAttribute("target", "_blank")
    })

    it("una factura anulada con foto fiscal incompleta (legacy) dice 'datos incompletos'", async () => {
      responder(pagina([fila({ estado: "anulado", pdfDisponible: false })]))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText(/datos incompletos/i)).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: /Ver PDF/i })).not.toBeInTheDocument()
    })

    it("una nota de credito se titula 'Nota de crédito B', muestra su numero y CAE, y no 'Factura B'", async () => {
      responder(pagina([notaCredito()]))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText("0001-00000002")).toBeInTheDocument()
      expect(screen.getByText("Nota de crédito B")).toBeInTheDocument()
      expect(screen.queryByText("Factura B")).not.toBeInTheDocument()
      expect(screen.getByText("74123456780002")).toBeInTheDocument()
      expect(screen.getByText("Emitida")).toBeInTheDocument()
    })

    it("el total de una nota de credito va con signo menos; el de una factura no", async () => {
      responder(pagina([notaCredito(), fila({ id: "c2", numero: "0001-00000009" })]))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000002")
      expect(screen.getByText("Nota de crédito B")).toBeInTheDocument()
      expect(screen.getByText("Factura B")).toBeInTheDocument()
      expect(screen.getByText(/^-.*1\.210/)).toBeInTheDocument()
      expect(screen.getByText(/^[^-]*1\.210/)).toBeInTheDocument()
    })

    it("una nota de credito emitida tiene su link 'Ver PDF'", async () => {
      responder(pagina([notaCredito()]))
      render(<ComprobantesArcaList />)
      const link = await screen.findByRole("link", { name: /Ver PDF/i })
      expect(link).toHaveAttribute("href", "/api/facturacion-electronica/comprobantes/nc1/pdf")
    })

    it("una nota de credito pendiente es 'En proceso' y sin numero dice 'Sin número'", async () => {
      responder(pagina([notaCredito({ estado: "pendiente", numero: null, cae: null, pdfDisponible: false, verificable: true })]))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText("En proceso")).toBeInTheDocument()
      expect(screen.getByText("Sin número")).toBeInTheDocument()
      expect(screen.getByText("Nota de crédito B")).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: /Ver PDF/i })).not.toBeInTheDocument()
      // Sin emitir no hay PDF que "estar incompleto": solo una raya.
      expect(screen.queryByText(/datos incompletos/i)).not.toBeInTheDocument()
    })

    it("una nota de credito rechazada muestra el motivo del rechazo", async () => {
      responder(pagina([notaCredito({ estado: "rechazado", numero: null, cae: null, errorMsg: "Comprobante asociado inexistente", pdfDisponible: false })]))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText("Rechazada")).toBeInTheDocument()
      expect(screen.getByText("Comprobante asociado inexistente")).toBeInTheDocument()
    })

    it("la primera columna se llama 'Comprobante' (hay facturas y notas de credito)", async () => {
      responder(pagina([fila()]))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000007")
      expect(screen.getByRole("columnheader", { name: "Comprobante" })).toBeInTheDocument()
    })
  })

  describe("paginacion", () => {
    it("muestra 'Página 1 de 3' y avanza con Siguiente", async () => {
      responder(pagina([fila()], { total: 45, totalPages: 3 }), pagina([fila({ id: "c9", numero: "0001-00000009" })], { total: 45, page: 2, totalPages: 3 }))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Anterior/i })).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
      expect(await screen.findByText("0001-00000009")).toBeInTheDocument()
      expect(urls().at(-1)).toBe("/api/facturacion-electronica/comprobantes?page=2&limit=20")
      expect(screen.getByText("Página 2 de 3")).toBeInTheDocument()
    })

    it("con una sola pagina no hay controles", async () => {
      responder(pagina([fila()]))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000007")
      expect(screen.queryByRole("button", { name: /Siguiente/i })).not.toBeInTheDocument()
    })
  })

  describe("estados vacio y error", () => {
    it("sin comprobantes: mensaje vacio", async () => {
      responder(pagina([], { total: 0, totalPages: 0 }))
      render(<ComprobantesArcaList />)
      expect(await screen.findByText("Todavía no hay facturas electrónicas")).toBeInTheDocument()
    })

    it("sin resultados para el filtro: mensaje distinto", async () => {
      responder(pagina([fila()]), pagina([], { total: 0, totalPages: 0 }))
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000007")
      fireEvent.click(screen.getByRole("option", { name: "Rechazadas" }))
      expect(await screen.findByText("No hay facturas con ese estado")).toBeInTheDocument()
    })

    it("si falla la carga muestra el error y permite reintentar", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "boom" }) })
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => pagina([fila()]) })
      render(<ComprobantesArcaList />)
      const alerta = await screen.findByRole("alert")
      expect(within(alerta).getByText(/No pudimos cargar las facturas/)).toBeInTheDocument()
      fireEvent.click(within(alerta).getByRole("button", { name: /Reintentar/i }))
      expect(await screen.findByText("0001-00000007")).toBeInTheDocument()
    })
  })
})
