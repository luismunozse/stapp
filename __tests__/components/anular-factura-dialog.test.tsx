// __tests__/components/anular-factura-dialog.test.tsx
/**
 * Dialogo de confirmacion para anular una factura ARCA: explica que se emite una
 * nota de credito electronica y que no se deshace, avisa cuando pasaron mas de 15
 * dias (RG 4540) sin bloquear, exige motivo (y detalle para "Otro"), no deja
 * enviar dos veces y no se puede cerrar mientras ARCA contesta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import React from "react"
import { AnularFacturaDialog } from "@/components/ventas/anular-factura-dialog"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const FACTURA = {
  id: "f1",
  tipo: "B",
  numero: "0003-00000001",
  total: 1210,
  fechaEmision: "2026-10-15",
  createdAt: "2026-10-15T15:00:00Z",
}

const NC = { id: "nc1", tipo: "B", numero: "0003-00000002", cae: "74123456789099", estado: "emitido" }

const URL_ANULAR = "/api/facturacion-electronica/comprobantes/f1/anular"

type Props = React.ComponentProps<typeof AnularFacturaDialog>

function elemento(props: Partial<Props> = {}, handlers = { onOpenChange: vi.fn(), onResultado: vi.fn() }) {
  return (
    <AnularFacturaDialog
      open
      factura={FACTURA}
      onOpenChange={handlers.onOpenChange}
      onResultado={handlers.onResultado}
      {...props}
    />
  )
}

function montar(props: Partial<Props> = {}) {
  const handlers = { onOpenChange: vi.fn(), onResultado: vi.fn() }
  const utils = render(elemento(props, handlers))
  return { ...handlers, ...utils, rerenderCon: (p: Partial<Props>) => utils.rerender(elemento(p, handlers)) }
}

function responder(status: number, body: unknown) {
  mockFetch.mockResolvedValue({ status, json: async () => body })
}

const dialogo = () => screen.getByRole("dialog")
const confirmar = () => screen.getByRole("button", { name: "Anular factura" })
const elegir = (nombre: string) => fireEvent.click(screen.getByRole("radio", { name: nombre }))
const escribirDetalle = (valor: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: valor } })

/** Pone a la factura `dias` dias atras respecto de "hoy" (fijo: 19/10/2026 a mediodia argentino). */
function facturaDeHaceDias(dias: number) {
  const emision = new Date(Date.UTC(2026, 9, 19 - dias)).toISOString().slice(0, 10)
  return { ...FACTURA, fechaEmision: emision }
}

const AVISO_PLAZO =
  "Pasaron más de 15 días desde la emisión de esta factura. ARCA no bloquea la nota de crédito, pero la RG 4540 pide emitirla dentro de ese plazo. Consultalo con tu contador antes de seguir."

describe("AnularFacturaDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-19T15:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe("contenido", () => {
    it("es un dialogo con el titulo 'Anular factura B 0003-00000001'", () => {
      montar()
      expect(screen.getByRole("dialog", { name: "Anular factura B 0003-00000001" })).toBeInTheDocument()
    })

    it("el titulo sigue a la factura (letra C, otro numero)", () => {
      montar({ factura: { ...FACTURA, tipo: "C", numero: "0001-00000010" } })
      expect(screen.getByRole("dialog", { name: "Anular factura C 0001-00000010" })).toBeInTheDocument()
    })

    it("explica que se emite una nota de credito electronica (ARCA) por el total", () => {
      montar()
      const texto = dialogo().textContent ?? ""
      expect(texto).toContain("nota de crédito electrónica (ARCA)")
      expect(texto).toMatch(/total que ARCA autorizó para esta factura/)
      expect(texto).toMatch(/1\.210,00/)
    })

    it("sin total en el listado no muestra un importe inventado", () => {
      montar({ factura: { ...FACTURA, total: null } })
      const texto = dialogo().textContent ?? ""
      expect(texto).toContain("total que ARCA autorizó para esta factura")
      expect(texto).not.toMatch(/en STApp figura/)
    })

    it("avisa que no se deshace y que no toca stock, caja, cuenta corriente ni el estado de la venta", () => {
      montar()
      const texto = dialogo().textContent ?? ""
      expect(texto).toContain("No se puede deshacer")
      expect(texto).toContain("No toca el stock, la caja, la cuenta corriente ni el estado de la venta")
      expect(texto).toContain("registrá la devolución aparte")
    })

    it("no muestra jerga fiscal interna", () => {
      montar()
      expect(dialogo().textContent).not.toMatch(/CbtesAsoc|snapshot|provider|cbte/i)
    })

    it("tiene los botones 'Anular factura' y 'Cancelar'", () => {
      montar()
      expect(confirmar()).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled()
    })

    it("el foco queda dentro del dialogo al abrir", () => {
      montar()
      expect(dialogo()).toContainElement(document.activeElement as HTMLElement)
    })
  })

  describe("motivo y detalle", () => {
    it("ofrece los tres motivos como opciones nativas, sin ninguna elegida", () => {
      montar()
      const radios = within(screen.getByRole("group", { name: /Motivo/ })).getAllByRole("radio")
      expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["error_factura", "devolucion_total", "otro"])
      expect(screen.getByRole("radio", { name: "Error en la factura" })).not.toBeChecked()
      expect(screen.getByRole("radio", { name: "Devolución total" })).not.toBeChecked()
      expect(screen.getByRole("radio", { name: "Otro" })).not.toBeChecked()
    })

    it("sin motivo no se puede confirmar", () => {
      montar()
      expect(confirmar()).toBeDisabled()
    })

    it("con un motivo elegido se puede confirmar, y el detalle es opcional", () => {
      montar()
      elegir("Error en la factura")
      expect(confirmar()).toBeEnabled()
      expect(screen.getByText(/Detalle \(opcional\)/)).toBeInTheDocument()
    })

    it("'Otro' exige detalle: vacio o en blanco no deja confirmar", () => {
      montar()
      elegir("Otro")
      expect(confirmar()).toBeDisabled()
      expect(screen.getByText(/Detalle \(obligatorio\)/)).toBeInTheDocument()
      escribirDetalle("    ")
      expect(confirmar()).toBeDisabled()
    })

    it("'Otro' con detalle deja confirmar", () => {
      montar()
      elegir("Otro")
      escribirDetalle("El cliente pidió otra razón social")
      expect(confirmar()).toBeEnabled()
    })

    it("cambiar de 'Otro' a otro motivo vuelve a hacer opcional el detalle", () => {
      montar()
      elegir("Otro")
      expect(confirmar()).toBeDisabled()
      elegir("Devolución total")
      expect(confirmar()).toBeEnabled()
    })

    it("el detalle respeta el limite de 500 caracteres de la ruta y muestra cuanto lleva", () => {
      montar()
      const detalle = screen.getByRole("textbox")
      expect(detalle).toHaveAttribute("maxlength", "500")
      escribirDetalle("hola")
      expect(screen.getByText("4/500")).toBeInTheDocument()
    })
  })

  describe("aviso de los 15 dias (RG 4540)", () => {
    it("a los 15 dias no avisa", () => {
      montar({ factura: facturaDeHaceDias(15) })
      expect(dialogo().textContent).not.toContain("RG 4540")
    })

    it("a los 16 dias avisa con el texto de siempre y NO bloquea: se puede confirmar", () => {
      montar({ factura: facturaDeHaceDias(16) })
      expect(screen.getByText(AVISO_PLAZO)).toBeInTheDocument()
      elegir("Error en la factura")
      expect(confirmar()).toBeEnabled()
    })

    it("con 40 dias tambien avisa y se puede confirmar", () => {
      montar({ factura: facturaDeHaceDias(40) })
      expect(screen.getByText(AVISO_PLAZO)).toBeInTheDocument()
      elegir("Devolución total")
      expect(confirmar()).toBeEnabled()
    })

    it("una factura vieja sin fecha de emision cuenta desde el dia (argentino) en que se creo", () => {
      // 01:00 UTC del 04/10 = 22:00 del 03/10 en Buenos Aires: son 16 dias, no 15.
      montar({ factura: { ...FACTURA, fechaEmision: null, createdAt: "2026-10-04T01:00:00Z" } })
      expect(screen.getByText(AVISO_PLAZO)).toBeInTheDocument()
    })

    it("sin ninguna fecha legible no afirma que venció", () => {
      montar({ factura: { ...FACTURA, fechaEmision: null, createdAt: "???" } })
      expect(dialogo().textContent).not.toContain("RG 4540")
    })
  })

  describe("cancelar", () => {
    it("Cancelar cierra sin mandar nada", () => {
      const { onOpenChange, onResultado } = montar()
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(onResultado).not.toHaveBeenCalled()
    })

    it("Cancelar con el formulario completo tampoco manda nada (no hace de 'enviar')", () => {
      const { onOpenChange, onResultado } = montar()
      elegir("Otro")
      escribirDetalle("Ya está todo completo")
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(onResultado).not.toHaveBeenCalled()
    })

    it("Escape tambien cierra sin mandar nada", () => {
      const { onOpenChange } = montar()
      fireEvent.keyDown(dialogo(), { key: "Escape" })
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("al volver a abrirlo el formulario esta limpio", () => {
      const { rerenderCon } = montar()
      elegir("Otro")
      escribirDetalle("algo que escribí")
      rerenderCon({ open: false })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      rerenderCon({ open: true })
      expect(screen.getByRole("radio", { name: "Otro" })).not.toBeChecked()
      expect(screen.getByRole("textbox")).toHaveValue("")
    })
  })

  describe("confirmar", () => {
    it("POSTea el motivo a la ruta de la factura", async () => {
      responder(200, { comprobante: NC, fueraDePlazo: false, diasDesdeEmision: 4 })
      montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(URL_ANULAR)
      expect(init.method).toBe("POST")
      expect(JSON.parse(init.body)).toEqual({ motivo: "error_factura" })
    })

    it("manda el detalle recortado junto al motivo", async () => {
      responder(200, { comprobante: NC })
      montar()
      elegir("Otro")
      escribirDetalle("  Cambió la razón social  ")
      fireEvent.click(confirmar())
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        motivo: "otro",
        motivoDetalle: "Cambió la razón social",
      })
    })

    it("un detalle opcional tambien viaja si se escribio", async () => {
      responder(200, { comprobante: NC })
      montar()
      elegir("Devolución total")
      escribirDetalle("Devolvió todo")
      fireEvent.click(confirmar())
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        motivo: "devolucion_total",
        motivoDetalle: "Devolvió todo",
      })
    })

    it("200: avisa al padre con el resultado y se cierra", async () => {
      responder(200, { comprobante: NC, fueraDePlazo: true, diasDesdeEmision: 20 })
      const { onResultado, onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onResultado).toHaveBeenCalledTimes(1)
      expect(onResultado).toHaveBeenCalledWith({ kind: "ok", comprobante: NC, fueraDePlazo: true, diasDesdeEmision: 20 })
    })

    it("envio incierto (502 + verificar): avisa al padre y se cierra, sin mostrar un error aca", async () => {
      responder(502, { error: "x", comprobante: { id: "nc9", estado: "pendiente" }, verificar: true })
      const { onResultado, onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onResultado).toHaveBeenCalledWith(expect.objectContaining({ kind: "incierta", comprobanteId: "nc9" }))
    })

    it("ARCA la autorizo pero no se registro (500 con CAE): avisa al padre y se cierra", async () => {
      responder(500, { error: "x", cae: "74123456789099", numero: "0003-00000002", comprobanteId: "nc9" })
      const { onResultado, onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onResultado).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "autorizadaSinRegistrar", cae: "74123456789099" })
      )
    })

    it("409 (otra pantalla ya hizo algo): avisa al padre y se cierra para que muestre el estado real", async () => {
      responder(409, { error: "Esta factura ya está anulada.", conflicto: "nc_activa" })
      const { onResultado, onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onResultado).toHaveBeenCalledWith({ kind: "conflicto", message: "Esta factura ya está anulada." })
    })

    it("se corto la conexion: no sabemos si llego, avisa al padre y se cierra para que vuelva a leer", async () => {
      mockFetch.mockRejectedValue(new Error("offline"))
      const { onResultado, onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onResultado).toHaveBeenCalledWith(expect.objectContaining({ kind: "sinConexion" }))
    })

    it("422: se queda abierto con el mensaje del servidor y deja volver a intentar", async () => {
      responder(422, { error: "10016: El número no es el siguiente al último autorizado." })
      const { onResultado, onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      expect(await screen.findByRole("alert")).toHaveTextContent("10016: El número no es el siguiente al último autorizado.")
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(onResultado).not.toHaveBeenCalled()
      expect(confirmar()).toBeEnabled()
      expect(screen.getByRole("radio", { name: "Error en la factura" })).toBeChecked()

      responder(200, { comprobante: NC })
      fireEvent.click(confirmar())
      await waitFor(() => expect(onResultado).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })))
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it("el error se limpia al empezar otro intento", async () => {
      responder(422, { error: "ARCA rechazó la nota de crédito." })
      montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await screen.findByRole("alert")

      let liberar!: () => void
      const espera = new Promise<void>((r) => (liberar = r))
      mockFetch.mockImplementation(async () => {
        await espera
        return { status: 200, json: async () => ({ comprobante: NC }) }
      })
      fireEvent.click(confirmar())
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
      liberar()
    })
  })

  describe("enviar el formulario sin pasar por el boton (Enter, lector de pantalla)", () => {
    const formulario = () => dialogo().querySelector("form") as HTMLFormElement

    it("sin motivo no manda nada", () => {
      montar()
      fireEvent.submit(formulario())
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("con 'Otro' y sin detalle no manda nada", () => {
      montar()
      elegir("Otro")
      escribirDetalle("   ")
      fireEvent.submit(formulario())
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("con todo completo manda una sola vez", async () => {
      responder(200, { comprobante: NC })
      montar()
      elegir("Devolución total")
      fireEvent.submit(formulario())
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    })

    it("frena el envio nativo del navegador: la pagina no se recarga", () => {
      responder(200, { comprobante: NC })
      montar()
      elegir("Devolución total")
      // dispatchEvent devuelve false cuando alguien llamo a preventDefault().
      expect(fireEvent.submit(formulario())).toBe(false)
    })
  })

  describe("mientras ARCA contesta", () => {
    function enVuelo() {
      let liberar!: () => void
      const espera = new Promise<void>((r) => (liberar = r))
      mockFetch.mockImplementation(async () => {
        await espera
        return { status: 200, json: async () => ({ comprobante: NC }) }
      })
      return liberar
    }

    it("el boton queda deshabilitado, dice 'Anulando...' y se avisa que puede tardar", async () => {
      const liberar = enVuelo()
      montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      const boton = await screen.findByRole("button", { name: /Anulando/ })
      expect(boton).toBeDisabled()
      expect(screen.getByRole("status")).toHaveTextContent(/puede tardar unos segundos/i)
      liberar()
    })

    it("un segundo envio (doble click o Enter repetido) NO dispara otra anulacion", async () => {
      const liberar = enVuelo()
      montar()
      elegir("Error en la factura")
      const form = dialogo().querySelector("form") as HTMLFormElement
      fireEvent.submit(form)
      fireEvent.submit(form)
      fireEvent.click(await screen.findByRole("button", { name: /Anulando/ }))
      liberar()
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    })

    it("no se puede cancelar ni cerrar con Escape hasta que ARCA conteste", async () => {
      const liberar = enVuelo()
      const { onOpenChange } = montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await screen.findByRole("button", { name: /Anulando/ })
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
      fireEvent.keyDown(dialogo(), { key: "Escape" })
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      liberar()
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    })

    it("no se puede cambiar el motivo mientras tanto", async () => {
      const liberar = enVuelo()
      montar()
      elegir("Error en la factura")
      fireEvent.click(confirmar())
      await screen.findByRole("button", { name: /Anulando/ })
      for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled()
      expect(screen.getByRole("textbox")).toBeDisabled()
      liberar()
    })
  })
})
