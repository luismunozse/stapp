// __tests__/components/comprobante-fiscal-card.test.tsx
/**
 * Bloque fiscal de la ficha de venta: estados none / pendiente / emitido /
 * rechazado / anulado, elegibilidad para emitir y emision con proteccion de doble
 * click; anular una factura (dialogo + nota de credito), verificar una nota
 * pendiente y volver a facturar despues de anular.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react"
import React from "react"
import { toast } from "sonner"
import { ComprobanteFiscalCard } from "@/components/ventas/comprobante-fiscal-card"
import { CONTACT_EMAIL } from "@/lib/contact"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
    cbteTipo: 6,
    esNotaCredito: false,
    comprobanteAsociadoId: null,
    anuladoAt: null,
    motivo: null,
    motivoDetalle: null,
    anulable: false,
    verificable: false,
    ...over,
  }
}

/** Una nota de credito electronica (ARCA) asociada a la factura `c1`. */
function nota(over: Item = {}): Item {
  return item({
    id: "n1",
    numero: "0001-00000008",
    cae: "74123456789099",
    caeVencimiento: "20261110",
    cbteTipo: 8,
    esNotaCredito: true,
    comprobanteAsociadoId: "c1",
    motivo: "error_factura",
    ...over,
  })
}

/** La factura `c1` ya anulada. */
const anulada = (over: Item = {}) => item({ estado: "anulado", anuladoAt: "2026-10-20T15:00:00Z", ...over })

function listado(items: Item[], puedeEmitir = true) {
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1, puedeEmitir }
}

interface Respuesta {
  status: number
  body: unknown
}

type Respuestas = Respuesta | Respuesta[]

/**
 * Responde por URL: el listado con las respuestas en cola (la ultima se repite) y,
 * segun la ruta, emitir / anular / verificar con la respuesta que se indique (o con
 * una lista, una por llamada: la ultima se repite).
 */
function montarFetch(
  listados: unknown[],
  emitir?: Respuestas,
  otras: { anular?: Respuestas; verificar?: Respuestas } = {}
) {
  const cola = [...listados]
  const colas = {
    emitir: [emitir ?? []].flat(),
    anular: [otras.anular ?? []].flat(),
    verificar: [otras.verificar ?? []].flat(),
  }
  const proxima = (c: Respuesta[]) => (c.length > 1 ? c.shift()! : c[0])
  const responder = (r: Respuesta) => ({ status: r.status, ok: r.status === 200, json: async () => r.body })
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/facturacion-electronica/emitir")) return responder(proxima(colas.emitir))
    if (url.endsWith("/anular")) return responder(proxima(colas.anular))
    if (url.endsWith("/verificar")) return responder(proxima(colas.verificar))
    const body = cola.length > 1 ? cola.shift() : cola[0]
    return { status: 200, ok: true, json: async () => body }
  })
}

const llamadasA = (sufijo: string) => mockFetch.mock.calls.filter(([url]) => String(url).endsWith(sufijo))

/** Abre el dialogo de la factura, elige el motivo y confirma. Devuelve el dialogo. */
async function anularConMotivo(motivo = "Error en la factura") {
  fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
  const dialogo = await screen.findByRole("dialog")
  fireEvent.click(within(dialogo).getByRole("radio", { name: motivo }))
  fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))
  return dialogo
}

const elegible = { estadoVenta: "COMPLETADA", tieneDevoluciones: false }

function renderCard(props: Partial<React.ComponentProps<typeof ComprobanteFiscalCard>> = {}) {
  return render(<ComprobanteFiscalCard ventaId="v1" {...elegible} {...props} />)
}

describe("ComprobanteFiscalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it("pide todos los comprobantes de la venta, no solo el ultimo: despues de anular el mas nuevo es la nota", async () => {
    montarFetch([listado([item()])])
    renderCard()
    await screen.findByText(/74123456789012/)
    expect(mockFetch).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes?ventaId=v1&limit=20")
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

    it("dice que la venta todavia no tiene factura", async () => {
      montarFetch([listado([], true)])
      renderCard()
      expect(await screen.findByText("Esta venta todavía no tiene factura electrónica.")).toBeInTheDocument()
    })

    it("una respuesta sin 'items' se toma por lista vacia: no rompe y deja emitir", async () => {
      mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => ({ puedeEmitir: true }) })
      renderCard()
      expect(await screen.findByRole("button", { name: /Emitir factura electrónica/i })).toBeEnabled()
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

    it("dos clicks en el mismo instante (antes de que se repinte el boton) emiten una sola vez", async () => {
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
      act(() => {
        boton.click()
        boton.click()
      })
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

    it("tras un 422 se puede volver a emitir, y el mensaje anterior se borra al empezar el nuevo intento", async () => {
      montarFetch(
        [listado([], true), listado([], true), listado([item()], true)],
        [
          { status: 422, body: { comprobante: { error_msg: "CUIT inválido" } } },
          { status: 200, body: { comprobante: { id: "c1" } } },
        ]
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: /Emitir factura electrónica/i }))
      expect(await screen.findByText("CUIT inválido")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: /Emitir factura electrónica/i }))
      await waitFor(() => expect(screen.queryByText("CUIT inválido")).not.toBeInTheDocument())
      expect(await screen.findByText(/74123456789012/)).toBeInTheDocument()
      expect(llamadasA("/emitir")).toHaveLength(2)
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

    it("avisa que se esta procesando y, si sigue asi, que escriba a soporte (sin liberar ni reintentar)", async () => {
      montarFetch([listado([item({ estado: "pendiente", cae: null, caeVencimiento: null, numero: null, pdfDisponible: false })], true)])
      renderCard()
      expect(await screen.findByText(/se está procesando/)).toBeInTheDocument()
      expect(screen.getByText(/soporte@stapp\.com\.ar/)).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /emitir|reintentar|liberar/i })).not.toBeInTheDocument()
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

    it("si el reintento falla con el mismo motivo que ya figura en la factura, no se repite el mensaje", async () => {
      montarFetch([listado([rechazado], true)], {
        status: 422,
        body: { comprobante: { error_msg: "Receptor sin CUIT válido" } },
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: /Reintentar/i }))
      await waitFor(() => expect(llamadasA("/emitir")).toHaveLength(1))
      await waitFor(() => expect(screen.getByRole("button", { name: /Reintentar/i })).toBeEnabled())
      expect(screen.getAllByText("Receptor sin CUIT válido")).toHaveLength(1)
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

  describe("Anular factura", () => {
    const anulable = item({ anulable: true })

    it("se ofrece sobre una factura anulable cuando se puede facturar", async () => {
      montarFetch([listado([anulable], true)])
      renderCard()
      expect(await screen.findByRole("button", { name: "Anular factura" })).toBeEnabled()
    })

    it("se ofrece aunque la venta tenga devoluciones o ya no este COMPLETADA: anular es un tema fiscal", async () => {
      montarFetch([listado([anulable], true)])
      renderCard({ estadoVenta: "ANULADA", tieneDevoluciones: true })
      expect(await screen.findByRole("button", { name: "Anular factura" })).toBeEnabled()
    })

    it("no se ofrece sin permiso para facturar (plan, toggle o credenciales)", async () => {
      montarFetch([listado([anulable], false)])
      renderCard()
      await screen.findByText(/74123456789012/)
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
    })

    it("no se ofrece si el servidor no la marca anulable (ya anulada, pendiente, de otro proveedor...)", async () => {
      montarFetch([listado([item({ anulable: false })], true)])
      renderCard()
      await screen.findByText(/74123456789012/)
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
    })

    it("no se ofrece si ya hay una nota de credito pendiente", async () => {
      const pendiente = nota({ estado: "pendiente", numero: null, cae: null, caeVencimiento: null, verificable: true, pdfDisponible: false })
      montarFetch([listado([pendiente, anulable], true)])
      renderCard()
      await screen.findByRole("button", { name: "Verificar con ARCA" })
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
    })

    it("no se ofrece si ya hay una nota de credito emitida", async () => {
      montarFetch([listado([nota(), anulable], true)])
      renderCard()
      await screen.findByText(/Nota de crédito electrónica B 0001-00000008/)
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
    })

    it("una nota rechazada no la bloquea: se puede volver a anular", async () => {
      const rechazada = nota({ estado: "rechazado", numero: null, cae: null, caeVencimiento: null, errorMsg: "ARCA la rechazó", pdfDisponible: false })
      montarFetch([listado([rechazada, anulable], true)])
      renderCard()
      expect(await screen.findByRole("button", { name: "Anular factura" })).toBeEnabled()
    })

    it("abre el dialogo de confirmacion y Cancelar no manda nada", async () => {
      montarFetch([listado([anulable], true)])
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog", { name: "Anular factura B 0001-00000007" })
      fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(llamadasA("/anular")).toHaveLength(0)
    })

    it("anula: manda el motivo a la ruta de la factura, avisa con un toast y muestra la factura anulada con su nota", async () => {
      montarFetch(
        [listado([anulable], true), listado([nota(), anulada()], true)],
        undefined,
        { anular: { status: 200, body: { comprobante: { id: "n1", tipo: "B", numero: "0001-00000008" }, anulado: { id: "c1" }, diasDesdeEmision: 1, fueraDePlazo: false } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Error en la factura" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
      expect(toast.success).toHaveBeenCalledWith(
        "Factura anulada. Se emitió la nota de crédito electrónica B 0001-00000008.",
        undefined
      )
      const [url, init] = llamadasA("/anular")[0]
      expect(url).toBe("/api/facturacion-electronica/comprobantes/c1/anular")
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ motivo: "error_factura" })

      expect(await screen.findByText("Anulada")).toBeInTheDocument()
      expect(screen.getByText("Nota de crédito electrónica B 0001-00000008")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    it("fuera de plazo (lo dice el servidor): el toast suma el aviso de la RG 4540", async () => {
      montarFetch(
        [listado([anulable], true), listado([nota(), anulada()], true)],
        undefined,
        { anular: { status: 200, body: { comprobante: { id: "n1", tipo: "B", numero: "0001-00000008" }, diasDesdeEmision: 20, fueraDePlazo: true } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Devolución total" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
      expect(toast.success).toHaveBeenCalledWith(
        "Factura anulada. Se emitió la nota de crédito electrónica B 0001-00000008.",
        { description: "Se emitió pasados los 15 días que pide la RG 4540. Consultalo con tu contador." }
      )
    })

    it("envio incierto (502): avisa que no se reintente, muestra la nota pendiente y 'Verificar con ARCA'", async () => {
      const pendiente = nota({ estado: "pendiente", numero: null, cae: null, caeVencimiento: null, verificable: true, pdfDisponible: false })
      montarFetch(
        [listado([anulable], true), listado([pendiente, anulable], true)],
        undefined,
        { anular: { status: 502, body: { error: "x", comprobante: { id: "n1", estado: "pendiente" }, verificar: true } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Error en la factura" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      expect(
        await screen.findByText(
          "No pudimos confirmar con ARCA si la nota de crédito quedó emitida. Tocá 'Verificar con ARCA' en unos minutos."
        )
      ).toBeInTheDocument()
      // Es un "hay que mirar", no una falla: se anuncia con calma (status), no como alerta.
      expect(screen.getByRole("status")).toHaveTextContent("Tocá 'Verificar con ARCA' en unos minutos.")
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(await screen.findByText("Pendiente de verificación")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Verificar con ARCA" })).toBeEnabled()
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it("422: el mensaje del servidor queda en el dialogo, que sigue abierto para reintentar", async () => {
      montarFetch([listado([anulable], true)], undefined, {
        anular: { status: 422, body: { error: "ARCA no encontró la factura original." } },
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Error en la factura" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      expect(await within(dialogo).findByRole("alert")).toHaveTextContent("ARCA no encontró la factura original.")
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it("409 (otra pantalla ya hizo algo): muestra el texto del servidor y vuelve a leer la ficha", async () => {
      montarFetch(
        [listado([anulable], true), listado([nota(), anulada()], true)],
        undefined,
        { anular: { status: 409, body: { error: "Esta factura ya tiene una nota de crédito.", notaCredito: { id: "n1" } } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Error en la factura" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      expect(await screen.findByText("Esta factura ya tiene una nota de crédito.")).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("Esta factura ya tiene una nota de crédito.")
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it("un aviso anterior se limpia cuando la anulacion siguiente sale bien", async () => {
      montarFetch(
        [listado([anulable], true), listado([anulable], true), listado([nota(), anulada()], true)],
        undefined,
        {
          anular: [
            { status: 409, body: { error: "La factura cambió mientras la anulabas." } },
            { status: 200, body: { comprobante: { id: "n1", tipo: "B", numero: "0001-00000008" } } },
          ],
        }
      )
      renderCard()
      await anularConMotivo()
      expect(await screen.findByText("La factura cambió mientras la anulabas.")).toBeInTheDocument()

      await anularConMotivo()
      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
      expect(screen.queryByText("La factura cambió mientras la anulabas.")).not.toBeInTheDocument()
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
    })

    it("ARCA la autorizo pero no se registro (500 con CAE): dice el CAE y que escriba a soporte, y vuelve a leer", async () => {
      const pendiente = nota({ estado: "pendiente", numero: null, cae: null, caeVencimiento: null, verificable: true, pdfDisponible: false })
      montarFetch(
        [listado([anulable], true), listado([pendiente, anulable], true)],
        undefined,
        { anular: { status: 500, body: { error: "x", cae: "74123456789099", numero: "0001-00000008", comprobanteId: "n1" } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Error en la factura" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      const alerta = await screen.findByRole("alert")
      expect(alerta).toHaveTextContent("ARCA autorizó la nota de crédito (CAE 74123456789099)")
      expect(alerta).toHaveTextContent(CONTACT_EMAIL)
      expect(await screen.findByText("Pendiente de verificación")).toBeInTheDocument()
    })

    it("se corto la conexion al anular: avisa que no sabemos si quedo anulada y vuelve a leer", async () => {
      let lecturas = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith("/anular")) throw new Error("offline")
        lecturas++
        return { status: 200, ok: true, json: async () => listado([anulable], true) }
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Anular factura" }))
      const dialogo = await screen.findByRole("dialog")
      fireEvent.click(within(dialogo).getByRole("radio", { name: "Error en la factura" }))
      fireEvent.click(within(dialogo).getByRole("button", { name: "Anular factura" }))

      expect(await screen.findByText(/Se cortó la conexión mientras anulábamos la factura/)).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("actualizá la pantalla para ver si quedó anulada")
      await waitFor(() => expect(lecturas).toBe(2))
    })
  })

  describe("factura anulada", () => {
    it("muestra la factura con el badge 'Anulada' y su nota de credito electronica con numero, CAE, vencimiento y motivo", async () => {
      montarFetch([listado([nota({ motivo: "devolucion_total" }), anulada()], true)])
      renderCard()
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
      expect(screen.getByText("Factura B 0001-00000007")).toBeInTheDocument()
      expect(screen.getByText("Nota de crédito electrónica B 0001-00000008")).toBeInTheDocument()
      expect(screen.getByText("74123456789012")).toBeInTheDocument()
      expect(screen.getByText("74123456789099")).toBeInTheDocument()
      expect(screen.getByText("29/10/2026")).toBeInTheDocument()
      expect(screen.getByText("10/11/2026")).toBeInTheDocument()
      expect(screen.getByText("Devolución total")).toBeInTheDocument()
    })

    it("el detalle del motivo, si lo hay, se ve junto al motivo", async () => {
      montarFetch([listado([nota({ motivo: "otro", motivoDetalle: "Cambió la razón social" }), anulada()], true)])
      renderCard()
      expect(await screen.findByText("Otro: Cambió la razón social")).toBeInTheDocument()
    })

    it("ofrece el PDF de la factura y el de la nota, cada uno con su link", async () => {
      montarFetch([listado([nota(), anulada()], true)])
      renderCard()
      const factura = await screen.findByRole("link", { name: "Ver PDF de Factura B 0001-00000007" })
      const nc = screen.getByRole("link", { name: "Ver PDF de Nota de crédito electrónica B 0001-00000008" })
      expect(factura).toHaveAttribute("href", "/api/facturacion-electronica/comprobantes/c1/pdf")
      expect(nc).toHaveAttribute("href", "/api/facturacion-electronica/comprobantes/n1/pdf")
    })

    it("si la nota no tiene PDF avisa 'datos incompletos' pero deja el PDF de la factura", async () => {
      montarFetch([listado([nota({ pdfDisponible: false }), anulada()], true)])
      renderCard()
      expect(await screen.findByText(/datos incompletos/i)).toBeInTheDocument()
      expect(screen.getAllByRole("link", { name: /Ver PDF/ })).toHaveLength(1)
    })

    it("muestra la fecha de la factura y la de la nota de credito", async () => {
      montarFetch([listado([nota({ fechaEmision: "2026-10-20" }), anulada({ fechaEmision: "2026-10-15" })], true)])
      renderCard()
      expect(await screen.findByText("15/10/2026")).toBeInTheDocument()
      expect(screen.getByText("20/10/2026")).toBeInTheDocument()
      expect(screen.getAllByText("Fecha")).toHaveLength(2)
    })

    it("una factura vieja sin fecha de emision no muestra una fecha inventada", async () => {
      montarFetch([listado([item({ fechaEmision: null })], true)])
      renderCard()
      await screen.findByText("74123456789012")
      expect(screen.queryByText("Fecha")).not.toBeInTheDocument()
    })

    it("no se ofrece 'Anular factura' sobre una factura ya anulada", async () => {
      montarFetch([listado([nota(), anulada({ anulable: false })], true)])
      renderCard()
      await screen.findByText("Anulada")
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
    })
  })

  describe("Emitir factura nueva", () => {
    it("tras anular se ofrece, como un click aparte: al cargar no se emite nada", async () => {
      montarFetch([listado([nota(), anulada()], true)])
      renderCard()
      expect(await screen.findByRole("button", { name: "Emitir factura nueva" })).toBeEnabled()
      expect(llamadasA("/emitir")).toHaveLength(0)
    })

    it("al hacer click emite con el mismo endpoint y la nueva factura pasa a ser la vigente; la anulada queda de historial con su nota", async () => {
      const nueva = item({ id: "c2", numero: "0001-00000009", cae: "74999999999999", caeVencimiento: "20261120" })
      montarFetch(
        [listado([nota(), anulada()], true), listado([nueva, nota(), anulada()], true)],
        { status: 200, body: { comprobante: { id: "c2" } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Emitir factura nueva" }))

      expect(await screen.findByText("74999999999999")).toBeInTheDocument()
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion-electronica/emitir",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ ventaId: "v1" }) })
      )
      expect(screen.queryByRole("button", { name: "Emitir factura nueva" })).not.toBeInTheDocument()
      // La factura nueva y la anulada conviven: la vieja y su nota quedan como historial.
      expect(screen.getByText("Facturas anteriores")).toBeInTheDocument()
      expect(screen.getByText("Factura B 0001-00000009")).toBeInTheDocument()
      expect(screen.getByText("Factura B 0001-00000007")).toBeInTheDocument()
      expect(screen.getByText("Nota de crédito electrónica B 0001-00000008")).toBeInTheDocument()
      // Cada factura del historial lleva su propio estado (la vigente lo muestra arriba).
      expect(screen.getByText("Anulada")).toBeInTheDocument()
      expect(screen.getByText("Emitida")).toBeInTheDocument()
    })

    it("el historial es de solo lectura: ninguna factura anterior ofrece acciones", async () => {
      const nueva = item({ id: "c2", numero: "0001-00000009", cae: "74999999999999", anulable: false })
      // Aunque el servidor marcara anulable a la vieja, el historial no ofrece anular.
      montarFetch([listado([nueva, nota(), anulada({ anulable: true })], true)])
      renderCard()
      await screen.findByText("Facturas anteriores")
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Emitir|Reintentar|Verificar/ })).not.toBeInTheDocument()
    })

    it("no se ofrece sin permiso para facturar", async () => {
      montarFetch([listado([nota(), anulada()], false)])
      renderCard()
      await screen.findByText("Anulada")
      expect(screen.queryByRole("button", { name: "Emitir factura nueva" })).not.toBeInTheDocument()
    })

    it("no se ofrece si la venta ya se anulo", async () => {
      montarFetch([listado([nota(), anulada()], true)])
      renderCard({ estadoVenta: "ANULADA" })
      await screen.findByText("Anulada")
      expect(screen.queryByRole("button", { name: "Emitir factura nueva" })).not.toBeInTheDocument()
    })

    it("no se ofrece si la venta tiene devoluciones", async () => {
      montarFetch([listado([nota(), anulada()], true)])
      renderCard({ tieneDevoluciones: true })
      await screen.findByText("Anulada")
      expect(screen.queryByRole("button", { name: "Emitir factura nueva" })).not.toBeInTheDocument()
    })

    it("no se ofrece mientras la factura sigue emitida, aunque haya una nota pendiente", async () => {
      const pendiente = nota({ estado: "pendiente", numero: null, cae: null, caeVencimiento: null, verificable: true, pdfDisponible: false })
      montarFetch([listado([pendiente, item()], true)])
      renderCard()
      await screen.findByRole("button", { name: "Verificar con ARCA" })
      expect(screen.queryByRole("button", { name: /Emitir/ })).not.toBeInTheDocument()
    })

    it("422 al emitir: muestra el mensaje y deja reintentar", async () => {
      montarFetch([listado([nota(), anulada()], true)], { status: 422, body: { comprobante: { error_msg: "CUIT inválido" } } })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Emitir factura nueva" }))
      expect(await screen.findByText("CUIT inválido")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Emitir factura nueva" })).toBeEnabled()
    })

    it("si el nuevo intento queda rechazado se ofrece 'Reintentar' y la anulada sigue en el historial", async () => {
      const rechazado = item({ id: "c2", estado: "rechazado", numero: null, cae: null, caeVencimiento: null, errorMsg: "Receptor sin CUIT válido", pdfDisponible: false })
      montarFetch([listado([rechazado, nota(), anulada()], true)])
      renderCard()
      expect(await screen.findByText("Receptor sin CUIT válido")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled()
      expect(screen.getByText("Facturas anteriores")).toBeInTheDocument()
      expect(screen.getByText("Nota de crédito electrónica B 0001-00000008")).toBeInTheDocument()
    })
  })

  describe("Verificar con ARCA", () => {
    const pendiente = nota({ estado: "pendiente", numero: null, cae: null, caeVencimiento: null, verificable: true, pdfDisponible: false })

    it("una nota pendiente se muestra como 'Pendiente de verificación' con su explicacion y el boton", async () => {
      montarFetch([listado([pendiente, item({ anulable: true })], true)])
      renderCard()
      expect(await screen.findByText("Pendiente de verificación")).toBeInTheDocument()
      expect(screen.getByText(/No vuelvas a anular la factura/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Verificar con ARCA" })).toBeEnabled()
      expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument()
    })

    it("se ofrece aunque ya no se pueda facturar: un cambio de plan no deja trabada una nota incierta", async () => {
      montarFetch([listado([pendiente, item({ anulable: true })], false)])
      renderCard()
      expect(await screen.findByRole("button", { name: "Verificar con ARCA" })).toBeEnabled()
    })

    it("una pendiente que el servidor no marca verificable no tiene boton y manda a soporte", async () => {
      montarFetch([listado([nota({ ...pendiente, verificable: false }), item()], true)])
      renderCard()
      await screen.findByText("Pendiente de verificación")
      expect(screen.queryByRole("button", { name: "Verificar con ARCA" })).not.toBeInTheDocument()
      expect(screen.getByText(new RegExp(CONTACT_EMAIL.replace(".", "\\.")))).toBeInTheDocument()
    })

    it("POSTea a la ruta de la NOTA (no de la factura); si ARCA la tenia: toast y la factura queda anulada", async () => {
      montarFetch(
        [listado([pendiente, item({ anulable: true })], true), listado([nota(), anulada()], true)],
        undefined,
        { verificar: { status: 200, body: { resultado: "adoptada", comprobante: { id: "n1" }, anulado: { id: "c1" } } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("ARCA ya tenía la nota de crédito: quedó registrada y la factura figura como anulada."))
      expect(llamadasA("/verificar")[0][0]).toBe("/api/facturacion-electronica/comprobantes/n1/verificar")
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
      expect(screen.queryByText("Pendiente de verificación")).not.toBeInTheDocument()
    })

    it("si ARCA NO la emitio: lo dice, la nota desaparece y 'Anular factura' vuelve", async () => {
      montarFetch(
        [listado([pendiente, item({ anulable: true })], true), listado([item({ anulable: true })], true)],
        undefined,
        { verificar: { status: 200, body: { resultado: "rechazada", mensaje: "ARCA no emitió la nota de crédito. Podés volver a anular la factura." } } }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))

      expect(await screen.findByText("ARCA no emitió la nota de crédito. Podés volver a anular la factura.")).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("Podés volver a anular la factura.")
      expect(await screen.findByRole("button", { name: "Anular factura" })).toBeEnabled()
      expect(screen.queryByText("Pendiente de verificación")).not.toBeInTheDocument()
    })

    it("si fue hace muy poco: pide probar en unos minutos y deja la nota pendiente", async () => {
      montarFetch([listado([pendiente, item({ anulable: true })], true)], undefined, {
        verificar: { status: 409, body: { resultado: "esperar", error: "El envío fue hace muy poco y ARCA puede seguir procesándolo: probá en unos minutos." } },
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))
      expect(await screen.findByText(/probá en unos minutos/)).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("probá en unos minutos")
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Verificar con ARCA" })).toBeEnabled()
      expect(screen.getByText("Pendiente de verificación")).toBeInTheDocument()
    })

    it("se puede volver a verificar despues de un 'esperar', y el aviso anterior se borra al empezar", async () => {
      montarFetch(
        [listado([pendiente, item({ anulable: true })], true), listado([pendiente, item({ anulable: true })], true), listado([nota(), anulada()], true)],
        undefined,
        {
          verificar: [
            { status: 409, body: { resultado: "esperar", error: "El envío fue hace muy poco: probá en unos minutos." } },
            { status: 200, body: { resultado: "adoptada", comprobante: { id: "n1" } } },
          ],
        }
      )
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))
      expect(await screen.findByText(/probá en unos minutos/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "Verificar con ARCA" }))
      await waitFor(() => expect(screen.queryByText(/probá en unos minutos/)).not.toBeInTheDocument())
      expect(await screen.findByText("Anulada")).toBeInTheDocument()
      expect(llamadasA("/verificar")).toHaveLength(2)
    })

    it("si los datos no cierran: el mensaje trae el mail de soporte", async () => {
      montarFetch([listado([pendiente, item({ anulable: true })], true)], undefined, {
        verificar: {
          status: 409,
          body: { resultado: "soporte", razon: "datos_distintos", error: `ARCA tiene una nota de crédito con ese número pero no coincide con la que enviamos. Contactá a soporte: ${CONTACT_EMAIL}.` },
        },
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))
      const alerta = await screen.findByRole("alert")
      expect(alerta).toHaveTextContent("no coincide con la que enviamos")
      expect(alerta).toHaveTextContent(CONTACT_EMAIL)
    })

    it("un error del servidor se muestra y el boton queda para reintentar", async () => {
      montarFetch([listado([pendiente, item({ anulable: true })], true)], undefined, {
        verificar: { status: 502, body: { error: "No pudimos comunicarnos con ARCA." } },
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos comunicarnos con ARCA.")
      expect(screen.getByRole("button", { name: "Verificar con ARCA" })).toBeEnabled()
    })

    it("mientras verifica el boton se deshabilita y un segundo click no dispara otra consulta", async () => {
      let liberar!: () => void
      const espera = new Promise<void>((r) => (liberar = r))
      let verificaciones = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith("/verificar")) {
          verificaciones++
          await espera
          return { status: 200, json: async () => ({ resultado: "emitida", comprobante: { id: "n1" } }) }
        }
        return { status: 200, ok: true, json: async () => listado([pendiente, item({ anulable: true })], true) }
      })
      renderCard()
      fireEvent.click(await screen.findByRole("button", { name: "Verificar con ARCA" }))
      const enCurso = await screen.findByRole("button", { name: /Verificando/ })
      expect(enCurso).toBeDisabled()
      fireEvent.click(enCurso)
      liberar()
      await waitFor(() => expect(verificaciones).toBe(1))
    })

    it("dos clicks en el mismo instante (antes de que se repinte el boton) verifican una sola vez", async () => {
      let liberar!: () => void
      const espera = new Promise<void>((r) => (liberar = r))
      let verificaciones = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith("/verificar")) {
          verificaciones++
          await espera
          return { status: 200, json: async () => ({ resultado: "emitida", comprobante: { id: "n1" } }) }
        }
        return { status: 200, ok: true, json: async () => listado([pendiente, item({ anulable: true })], true) }
      })
      renderCard()
      const boton = await screen.findByRole("button", { name: "Verificar con ARCA" })
      act(() => {
        boton.click()
        boton.click()
      })
      liberar()
      await waitFor(() => expect(verificaciones).toBe(1))
    })
  })

  it("la ficha no expone datos internos del proveedor", async () => {
    montarFetch([listado([nota(), anulada()], true)])
    renderCard()
    await screen.findByText("Anulada")
    expect(document.body.textContent).not.toMatch(/provider|CbtesAsoc|snapshot/i)
  })
})
