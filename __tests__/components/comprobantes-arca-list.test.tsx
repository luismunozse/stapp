// __tests__/components/comprobantes-arca-list.test.tsx
/**
 * Listado "Comprobantes ARCA" de /facturacion: filas, filtro por estado (con el
 * valor "todos", nunca vacio), paginacion, estados vacio y de error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react"
import React, { type ReactNode } from "react"
import { ComprobantesArcaList } from "@/components/facturacion/comprobantes-arca-list"
import { CONTACT_EMAIL } from "@/lib/contact"

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
    notaCreditoEnCursoId: null,
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
  describe("acciones por fila: anular y verificar", () => {
    const MSG_ANULADA = "Factura anulada. Se emitió la nota de crédito electrónica B 0001-00000008."
    const ANULAR_OK = {
      status: 200,
      body: { comprobante: { id: "nc9", tipo: "B", numero: "0001-00000008" }, anulado: { id: "c1" }, diasDesdeEmision: 1, fueraDePlazo: false },
    }
    const pendiente = (over: Item = {}) =>
      notaCredito({ estado: "pendiente", numero: null, cae: null, pdfDisponible: false, verificable: true, ...over })

    interface Respuesta {
      status: number
      body: unknown
    }

    /** Listado en cola (el ultimo se repite) y, por ruta, las respuestas de anular / verificar. */
    function montar(listados: unknown[], rutas: { anular?: Respuesta | Respuesta[]; verificar?: Respuesta | Respuesta[] } = {}) {
      const cola = [...listados]
      const colas = { anular: [rutas.anular ?? []].flat(), verificar: [rutas.verificar ?? []].flat() }
      const proxima = (c: Respuesta[]) => (c.length > 1 ? c.shift()! : c[0])
      const responder = (r: Respuesta) => ({ status: r.status, ok: r.status === 200, json: async () => r.body })
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/anular")) return responder(proxima(colas.anular))
        if (url.endsWith("/verificar")) return responder(proxima(colas.verificar))
        const body = cola.length > 1 ? cola.shift() : cola[0]
        return { status: 200, ok: true, json: async () => body }
      })
    }

    const llamadasA = (sufijo: string) => mockFetch.mock.calls.filter(([url]) => String(url).endsWith(sufijo))
    // El dialogo tambien tiene su propio role="status" ("Estamos emitiendo..."): se busca el aviso del listado por su texto.
    const avisoQue = (texto: string) =>
      waitFor(() => {
        const aviso = screen.getAllByRole("status").find((el) => el.textContent?.includes(texto))
        expect(aviso).toBeDefined()
        return aviso!
      })
    const botonAnularActual = (numero = "0001-00000007") => screen.getByRole("button", { name: `Anular factura B ${numero}` })
    const botonAnular = (numero = "0001-00000007") => screen.findByRole("button", { name: `Anular factura B ${numero}` })

    async function anularConMotivo(motivo = "Error en la factura") {
      fireEvent.click(await botonAnular())
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: motivo }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))
      return dialogo
    }

    describe("que botones aparecen (solo donde el listado lo permite)", () => {
      it("factura anulable: 'Anular factura', dentro de la celda del comprobante (visible tambien en el celular)", async () => {
        responder(pagina([fila()]))
        render(<ComprobantesArcaList />)
        const boton = await botonAnular()
        expect(boton).toBeEnabled()
        const celda = boton.closest("td")!
        // Las columnas Fecha y CAE se esconden en pantallas chicas: la accion no puede vivir ahi.
        expect(celda.className).not.toMatch(/\bhidden\b/)
        expect(within(celda).getByText("0001-00000007")).toBeInTheDocument()
      })

      it.each([
        ["factura no anulable (el listado dice que no)", fila({ anulable: false })],
        ["factura anulada", fila({ estado: "anulado", anulable: false })],
        ["factura rechazada", fila({ estado: "rechazado", anulable: false, numero: null, cae: null })],
        ["nota de credito emitida", notaCredito()],
      ])("%s: sin botones de accion", async (_n, item) => {
        responder(pagina([item]))
        render(<ComprobantesArcaList />)
        await screen.findByText(/^Factura B$|^Nota de crédito B$/)
        expect(screen.queryByRole("button", { name: /Anular factura/ })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Verificar con ARCA/ })).not.toBeInTheDocument()
      })

      it("nota de credito verificable: 'Verificar con ARCA' en la celda del comprobante", async () => {
        responder(pagina([pendiente()]))
        render(<ComprobantesArcaList />)
        const boton = await screen.findByRole("button", { name: /Verificar con ARCA/ })
        expect(boton).toHaveAccessibleName(/nota de crédito electrónica B/)
        expect(boton.closest("td")!.className).not.toMatch(/\bhidden\b/)
        expect(screen.queryByRole("button", { name: /Anular factura/ })).not.toBeInTheDocument()
      })

      it("nota pendiente que el servidor no marca verificable: sin boton", async () => {
        responder(pagina([pendiente({ verificable: false })]))
        render(<ComprobantesArcaList />)
        await screen.findByText("En proceso")
        expect(screen.queryByRole("button", { name: /Verificar con ARCA/ })).not.toBeInTheDocument()
      })

      it("factura con una nota de credito en curso: lo dice y no ofrece anular", async () => {
        responder(pagina([fila({ anulable: false, notaCreditoEnCursoId: "nc9" })]))
        render(<ComprobantesArcaList />)
        expect(await screen.findByText("Nota de crédito en curso")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Anular factura/ })).not.toBeInTheDocument()
      })
    })

    it("mientras se recarga la lista las filas viejas no se pueden anular", async () => {
      let soltar!: (r: unknown) => void
      let llamada = 0
      mockFetch.mockImplementation(() => {
        llamada += 1
        if (llamada === 1) return Promise.resolve({ status: 200, ok: true, json: async () => pagina([fila()]) })
        return new Promise((resolve) => {
          soltar = resolve
        })
      })
      render(<ComprobantesArcaList />)
      expect(await botonAnular()).toBeEnabled()
      fireEvent.click(screen.getByRole("option", { name: "Emitidas" }))
      await waitFor(() => expect(botonAnularActual()).toBeDisabled())
      await act(async () => {
        soltar({ status: 200, ok: true, json: async () => pagina([fila()]) })
      })
      await waitFor(() => expect(botonAnularActual()).toBeEnabled())
    })

    describe("anular", () => {
      it("abre el dialogo de esa factura (uno solo) y manda el motivo a la ruta de la factura", async () => {
        montar([pagina([fila(), fila({ id: "c2", numero: "0001-00000009", numeroVenta: 6, ventaId: "v2" })]), pagina([])], { anular: ANULAR_OK })
        render(<ComprobantesArcaList />)
        fireEvent.click(await botonAnular("0001-00000009"))
        const dialogo = await screen.findByRole("dialog")
        expect(screen.getAllByRole("dialog")).toHaveLength(1)
        expect(within(dialogo).getByText("Anular factura B 0001-00000009")).toBeInTheDocument()
        fireEvent.click(within(dialogo).getByRole("radio", { name: "Devolución total" }))
        fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

        await waitFor(() => expect(llamadasA("/anular")).toHaveLength(1))
        const [url, init] = llamadasA("/anular")[0]
        expect(url).toBe("/api/facturacion-electronica/comprobantes/c2/anular")
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({ motivo: "devolucion_total" })
      })

      it("anulada: aviso con el resultado y link a la venta para volver a facturar; recarga la misma pagina y filtro", async () => {
        const pagina2 = pagina([fila()], { total: 45, page: 2, totalPages: 3 })
        const pagina1 = pagina([fila({ id: "x", numero: "0001-00000001" })], { total: 45, totalPages: 3 })
        montar([pagina1, pagina1, pagina2], { anular: ANULAR_OK })
        render(<ComprobantesArcaList />)
        await screen.findByText("0001-00000001")
        fireEvent.click(screen.getByRole("option", { name: "Emitidas" }))
        fireEvent.click(await screen.findByRole("button", { name: /Siguiente/i }))
        await botonAnular()
        const antes = urls().length
        await anularConMotivo()

        const aviso = await avisoQue(MSG_ANULADA)
        expect(aviso).toHaveTextContent(MSG_ANULADA)
        expect(aviso).toHaveTextContent("Para volver a facturarla, abrí la venta V0005.")
        expect(within(aviso).getByRole("link", { name: "abrí la venta V0005" })).toHaveAttribute("href", "/ventas/v1")
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
        // Recarga exactamente la pagina y el filtro que se estaban mirando.
        await waitFor(() => expect(urls().length).toBeGreaterThan(antes))
        expect(urls().at(-1)).toBe("/api/facturacion-electronica/comprobantes?page=2&limit=20&estado=emitido")
      })

      it("sin venta en la fila no inventa un link", async () => {
        montar([pagina([fila({ ventaId: null, numeroVenta: null })]), pagina([])], { anular: ANULAR_OK })
        render(<ComprobantesArcaList />)
        await anularConMotivo()
        const aviso = await avisoQue(MSG_ANULADA)
        expect(aviso).toHaveTextContent(MSG_ANULADA)
        expect(within(aviso).queryByRole("link")).not.toBeInTheDocument()
        expect(aviso).not.toHaveTextContent("Para volver a facturarla")
      })

      it("fuera de plazo: el aviso suma lo de la RG 4540", async () => {
        montar([pagina([fila()]), pagina([])], {
          anular: { status: 200, body: { ...(ANULAR_OK.body as object), fueraDePlazo: true, diasDesdeEmision: 20 } },
        })
        render(<ComprobantesArcaList />)
        await anularConMotivo()
        expect(await avisoQue("Se emitió pasados los 15 días que pide la RG 4540. Consultalo con tu contador.")).toHaveTextContent("Se emitió pasados los 15 días que pide la RG 4540. Consultalo con tu contador.")
      })

      it("envio incierto (502): avisa que no se reintente y recarga para mostrar la nota pendiente", async () => {
        montar([pagina([fila()]), pagina([pendiente()])], {
          anular: {
            status: 502,
            body: { error: "x", verificar: true, comprobante: { id: "nc9", estado: "pendiente", cbte_nro_solicitado: 8 } },
          },
        })
        render(<ComprobantesArcaList />)
        await anularConMotivo()
        const aviso = await avisoQue("Tocá")
        expect(aviso).toHaveTextContent("Tocá 'Verificar con ARCA' en unos minutos.")
        expect(await screen.findByRole("button", { name: /Verificar con ARCA/ })).toBeEnabled()
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })

      it("autorizada pero sin registrar: alerta con el CAE y el mail de soporte", async () => {
        montar([pagina([fila()]), pagina([fila()])], {
          anular: { status: 500, body: { error: "rpc", cae: "75000000000001", numero: "0001-00000008", comprobanteId: "nc9" } },
        })
        render(<ComprobantesArcaList />)
        await anularConMotivo()
        const alerta = await screen.findByRole("alert")
        expect(alerta).toHaveTextContent("75000000000001")
        expect(alerta).toHaveTextContent(CONTACT_EMAIL)
      })

      it("la factura cambio mientras se anulaba (409): aviso y recarga", async () => {
        montar([pagina([fila()]), pagina([fila({ estado: "anulado", anulable: false })])], {
          anular: { status: 409, body: { error: "La factura ya fue anulada." } },
        })
        render(<ComprobantesArcaList />)
        await anularConMotivo()
        expect(await avisoQue("La factura ya fue anulada.")).toHaveTextContent("La factura ya fue anulada.")
        expect(await screen.findByText("Anulada")).toBeInTheDocument()
      })

      it("si el servidor rechaza (422), el error queda en el dialogo y no se recarga el listado", async () => {
        montar([pagina([fila()])], { anular: { status: 422, body: { error: "ARCA rechazó la nota de crédito." } } })
        render(<ComprobantesArcaList />)
        const dialogo = await anularConMotivo()
        expect(await within(dialogo).findByRole("alert")).toHaveTextContent("ARCA rechazó la nota de crédito.")
        expect(screen.getByRole("dialog")).toBeInTheDocument()
        expect(urls().filter((u) => !u.endsWith("/anular"))).toHaveLength(1)
      })

      it("cancelar el dialogo no llama a ARCA ni recarga", async () => {
        montar([pagina([fila()])])
        render(<ComprobantesArcaList />)
        fireEvent.click(await botonAnular())
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }))
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
        expect(llamadasA("/anular")).toHaveLength(0)
        expect(urls()).toHaveLength(1)
      })

      it("el aviso se puede cerrar a mano", async () => {
        montar([pagina([fila()]), pagina([fila()])], { anular: ANULAR_OK })
        render(<ComprobantesArcaList />)
        await anularConMotivo()
        expect(await avisoQue(MSG_ANULADA)).toHaveTextContent(MSG_ANULADA)
        fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }))
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      })
    })

    describe("verificar con ARCA", () => {
      const verificar = (body: unknown, status = 200) => ({ verificar: { status, body } })

      async function clickVerificar() {
        fireEvent.click(await screen.findByRole("button", { name: /Verificar con ARCA/ }))
      }

      it("POSTea a la ruta de la NOTA; si ARCA la tenia: aviso con link a la venta y recarga", async () => {
        montar(
          [pagina([pendiente(), fila({ anulable: false, notaCreditoEnCursoId: "nc1" })]), pagina([notaCredito(), fila({ estado: "anulado", anulable: false })])],
          verificar({ resultado: "adoptada", comprobante: { id: "nc1" }, anulado: { id: "c1" } })
        )
        render(<ComprobantesArcaList />)
        await clickVerificar()
        const aviso = await screen.findByRole("status")
        expect(aviso).toHaveTextContent("ARCA ya tenía la nota de crédito: quedó registrada y la factura figura como anulada.")
        expect(aviso).toHaveTextContent("Para volver a facturarla, abrí la venta V0005.")
        expect(llamadasA("/verificar")[0][0]).toBe("/api/facturacion-electronica/comprobantes/nc1/verificar")
        expect(await screen.findByText("Anulada")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Verificar con ARCA/ })).not.toBeInTheDocument()
      })

      it("si ARCA no la emitio: lo dice (aviso) y recarga", async () => {
        montar(
          [pagina([pendiente()]), pagina([fila()])],
          verificar({ resultado: "rechazada", mensaje: "ARCA no emitió la nota de crédito. Podés volver a anular la factura." })
        )
        render(<ComprobantesArcaList />)
        await clickVerificar()
        expect(await screen.findByRole("status")).toHaveTextContent("ARCA no emitió la nota de crédito. Podés volver a anular la factura.")
        expect(await botonAnular()).toBeEnabled()
      })

      it("si fue hace muy poco: pide probar en unos minutos y deja el boton", async () => {
        montar([pagina([pendiente()])], verificar({ resultado: "esperar", error: "El envío fue hace muy poco: probá en unos minutos." }, 409))
        render(<ComprobantesArcaList />)
        await clickVerificar()
        expect(await screen.findByRole("status")).toHaveTextContent("probá en unos minutos")
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: /Verificar con ARCA/ })).toBeEnabled()
      })

      it("si los datos no cierran: alerta con el mail de soporte", async () => {
        montar(
          [pagina([pendiente()])],
          verificar({ resultado: "soporte", razon: "datos_distintos", error: `No coincide con la que enviamos. Contactá a soporte: ${CONTACT_EMAIL}.` }, 409)
        )
        render(<ComprobantesArcaList />)
        await clickVerificar()
        const alerta = await screen.findByRole("alert")
        expect(alerta).toHaveTextContent("No coincide con la que enviamos")
        expect(alerta).toHaveTextContent(CONTACT_EMAIL)
      })

      it("la nota cambio mientras tanto: aviso y recarga", async () => {
        montar([pagina([pendiente()]), pagina([notaCredito()])], verificar({ resultado: "cambio", error: "La nota cambió: actualizamos la pantalla." }, 409))
        render(<ComprobantesArcaList />)
        await clickVerificar()
        expect(await screen.findByRole("status")).toHaveTextContent("La nota cambió: actualizamos la pantalla.")
        await waitFor(() => expect(screen.queryByRole("button", { name: /Verificar con ARCA/ })).not.toBeInTheDocument())
      })

      it.each([
        [503, "La anulación de facturas todavía no está disponible. Contactá a soporte."],
        [502, "No pudimos hablar con ARCA. Probá de nuevo en unos minutos."],
      ])("error %s del servidor: alerta con el texto del servidor", async (status, error) => {
        montar([pagina([pendiente()])], verificar({ error }, status))
        render(<ComprobantesArcaList />)
        await clickVerificar()
        expect(await screen.findByRole("alert")).toHaveTextContent(error)
      })

      it("se cayo la conexion: alerta sin romper la lista", async () => {
        const cola = pagina([pendiente()])
        mockFetch.mockImplementation(async (url: string) => {
          if (url.endsWith("/verificar")) throw new TypeError("Failed to fetch")
          return { status: 200, ok: true, json: async () => cola }
        })
        render(<ComprobantesArcaList />)
        await clickVerificar()
        expect(await screen.findByRole("alert")).toHaveTextContent("Se cortó la conexión mientras verificábamos con ARCA.")
        expect(screen.getByRole("button", { name: /Verificar con ARCA/ })).toBeEnabled()
      })

      it("doble click: una sola verificacion; mientras ARCA contesta todas las acciones quedan deshabilitadas", async () => {
        let soltar!: (r: unknown) => void
        mockFetch.mockImplementation((url: string) => {
          if (url.endsWith("/verificar")) {
            return new Promise((resolve) => {
              soltar = resolve
            })
          }
          return Promise.resolve({ status: 200, ok: true, json: async () => pagina([pendiente(), fila({ id: "c2", numero: "0001-00000009" })]) })
        })
        render(<ComprobantesArcaList />)
        const boton = await screen.findByRole("button", { name: /Verificar con ARCA/ })
        act(() => {
          boton.click()
          boton.click()
        })
        expect(llamadasA("/verificar")).toHaveLength(1)
        expect(await screen.findByText("Verificando...")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /Verificando/ })).toBeDisabled()
        expect(screen.getByRole("button", { name: "Anular factura B 0001-00000009" })).toBeDisabled()

        await act(async () => {
          soltar({ status: 409, ok: false, json: async () => ({ resultado: "esperar", error: "probá en unos minutos" }) })
        })
        await waitFor(() => expect(screen.getByRole("button", { name: "Anular factura B 0001-00000009" })).toBeEnabled())
      })
    })

    it("si tras recargar la pagina quedo fuera de rango, vuelve a la ultima que existe", async () => {
      const ultima = pagina([fila({ id: "z", numero: "0001-00000003" })], { total: 20, page: 1, totalPages: 1 })
      montar(
        [
          pagina([fila({ id: "a", numero: "0001-00000001" })], { total: 21, totalPages: 2 }),
          pagina([fila()], { total: 21, page: 2, totalPages: 2 }),
          pagina([], { total: 20, page: 2, totalPages: 1 }),
          ultima,
        ],
        { anular: ANULAR_OK }
      )
      render(<ComprobantesArcaList />)
      await screen.findByText("0001-00000001")
      fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
      await anularConMotivo()
      expect(await screen.findByText("0001-00000003")).toBeInTheDocument()
      expect(urls().at(-1)).toBe("/api/facturacion-electronica/comprobantes?page=1&limit=20")
    })
  })
})
