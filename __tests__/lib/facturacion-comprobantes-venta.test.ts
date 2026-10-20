// @vitest-environment node
// __tests__/lib/facturacion-comprobantes-venta.test.ts
/**
 * Como se ordenan los comprobantes de UNA venta para la ficha: el listado trae
 * facturas y notas de credito mezcladas (la mas nueva primero); la ficha necesita
 * cada factura con sus notas, la vigente aparte y el resto como historial.
 */
import { describe, it, expect } from "vitest"
import type { ComprobanteFiscalDTO } from "@/lib/facturacion/comprobante-ui"
import {
  agruparComprobantesVenta,
  puedeAnularFactura,
  notaCreditoPorVerificar,
} from "@/lib/facturacion/comprobantes-venta"

let secuencia = 0

function fila(over: Partial<ComprobanteFiscalDTO> = {}): ComprobanteFiscalDTO {
  secuencia += 1
  return {
    id: `c${secuencia}`,
    ventaId: "v1",
    numeroVenta: 5,
    tipo: "B",
    puntoVenta: 3,
    numero: `0003-${String(secuencia).padStart(8, "0")}`,
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

const factura = (over: Partial<ComprobanteFiscalDTO> = {}) => fila({ cbteTipo: 6, ...over })

const nota = (facturaId: string, over: Partial<ComprobanteFiscalDTO> = {}) =>
  fila({ cbteTipo: 8, esNotaCredito: true, comprobanteAsociadoId: facturaId, motivo: "error_factura", ...over })

describe("agruparComprobantesVenta", () => {
  it("sin comprobantes no hay factura vigente ni historial", () => {
    expect(agruparComprobantesVenta([])).toEqual({ vigente: null, historial: [] })
  })

  it("una factura emitida es la vigente y no tiene notas", () => {
    const f = factura({ id: "f1" })
    expect(agruparComprobantesVenta([f])).toEqual({ vigente: { factura: f, notasCredito: [] }, historial: [] })
  })

  it("la nota de credito emitida cuelga de su factura anulada, aunque llegue primero en la lista", () => {
    const f = factura({ id: "f1", estado: "anulado", anuladoAt: "2026-10-20T15:00:00Z" })
    const nc = nota("f1", { id: "n1" })
    expect(agruparComprobantesVenta([nc, f])).toEqual({
      vigente: { factura: f, notasCredito: [nc] },
      historial: [],
    })
  })

  it("tras reemplazar una factura anulada, la nueva es la vigente y la vieja pasa a historial con su nota", () => {
    const f2 = factura({ id: "f2" })
    const nc1 = nota("f1", { id: "n1" })
    const f1 = factura({ id: "f1", estado: "anulado" })
    const grupos = agruparComprobantesVenta([f2, nc1, f1])
    expect(grupos.vigente).toEqual({ factura: f2, notasCredito: [] })
    expect(grupos.historial).toEqual([{ factura: f1, notasCredito: [nc1] }])
  })

  it("no mezcla las notas de una factura con las de otra", () => {
    const f2 = factura({ id: "f2", estado: "anulado" })
    const nc2 = nota("f2", { id: "n2" })
    const f1 = factura({ id: "f1", estado: "anulado" })
    const nc1 = nota("f1", { id: "n1" })
    const grupos = agruparComprobantesVenta([nc2, f2, nc1, f1])
    expect(grupos.vigente).toEqual({ factura: f2, notasCredito: [nc2] })
    expect(grupos.historial).toEqual([{ factura: f1, notasCredito: [nc1] }])
  })

  it("una nota pendiente cuenta: hay una anulacion en curso", () => {
    const f = factura({ id: "f1" })
    const nc = nota("f1", { id: "n1", estado: "pendiente", numero: null, cae: null, verificable: true })
    expect(agruparComprobantesVenta([nc, f]).vigente).toEqual({ factura: f, notasCredito: [nc] })
  })

  it("una nota rechazada no se muestra ni cuenta como anulacion en curso", () => {
    const f = factura({ id: "f1" })
    const rechazada = nota("f1", { id: "n1", estado: "rechazado", errorMsg: "ARCA la rechazó" })
    expect(agruparComprobantesVenta([rechazada, f]).vigente).toEqual({ factura: f, notasCredito: [] })
  })

  it("con un intento rechazado y otro emitido solo queda el emitido", () => {
    const f = factura({ id: "f1", estado: "anulado" })
    const buena = nota("f1", { id: "n2" })
    const rechazada = nota("f1", { id: "n1", estado: "rechazado" })
    expect(agruparComprobantesVenta([buena, rechazada, f]).vigente?.notasCredito).toEqual([buena])
  })

  it("un intento de emision rechazado y viejo no ensucia el historial", () => {
    const vigente = factura({ id: "f3" })
    const viejoRechazado = factura({ id: "f2", estado: "rechazado", cae: null, numero: null })
    const anulada = factura({ id: "f1", estado: "anulado" })
    const grupos = agruparComprobantesVenta([vigente, viejoRechazado, anulada])
    expect(grupos.historial.map((g) => g.factura.id)).toEqual(["f1"])
  })

  it("si el ultimo intento de emitir fue rechazado, ese es el vigente y la anulada queda de historial", () => {
    const rechazada = factura({ id: "f2", estado: "rechazado", cae: null, numero: null })
    const nc1 = nota("f1", { id: "n1" })
    const f1 = factura({ id: "f1", estado: "anulado" })
    const grupos = agruparComprobantesVenta([rechazada, nc1, f1])
    expect(grupos.vigente).toEqual({ factura: rechazada, notasCredito: [] })
    expect(grupos.historial).toEqual([{ factura: f1, notasCredito: [nc1] }])
  })

  it("una nota cuya factura no esta en la lista (historial muy viejo) se ignora", () => {
    const f = factura({ id: "f1" })
    const huerfana = nota("fuera-de-pagina", { id: "n9" })
    expect(agruparComprobantesVenta([huerfana, f])).toEqual({ vigente: { factura: f, notasCredito: [] }, historial: [] })
  })

  it("solo notas, sin ninguna factura: no hay vigente", () => {
    expect(agruparComprobantesVenta([nota("f1")])).toEqual({ vigente: null, historial: [] })
  })

  it("filas del servidor sin los campos nuevos se toman por facturas", () => {
    const vieja = { ...factura({ id: "f1" }) } as Partial<ComprobanteFiscalDTO>
    delete vieja.esNotaCredito
    delete vieja.comprobanteAsociadoId
    expect(agruparComprobantesVenta([vieja as ComprobanteFiscalDTO]).vigente?.factura.id).toBe("f1")
  })

  it("respeta el orden del listado (la mas nueva primero) en el historial", () => {
    const vigente = factura({ id: "f3" })
    const f2 = factura({ id: "f2", estado: "anulado" })
    const f1 = factura({ id: "f1", estado: "anulado" })
    expect(agruparComprobantesVenta([vigente, f2, f1]).historial.map((g) => g.factura.id)).toEqual(["f2", "f1"])
  })
})

describe("puedeAnularFactura", () => {
  const anulable = (over: Partial<ComprobanteFiscalDTO> = {}) => factura({ id: "f1", anulable: true, ...over })

  it("una factura anulable, con el permiso y sin notas en curso, se puede anular", () => {
    expect(puedeAnularFactura({ factura: anulable(), notasCredito: [] }, true)).toBe(true)
  })

  it("sin permiso para facturar (plan, toggle o credenciales) no se ofrece", () => {
    expect(puedeAnularFactura({ factura: anulable(), notasCredito: [] }, false)).toBe(false)
  })

  it("si la fila misma no es anulable (anulada, de otro proveedor, sin CAE...) no se ofrece", () => {
    expect(puedeAnularFactura({ factura: anulable({ anulable: false }), notasCredito: [] }, true)).toBe(false)
  })

  it("con una nota pendiente no se ofrece: primero se verifica", () => {
    const nc = nota("f1", { estado: "pendiente", verificable: true })
    expect(puedeAnularFactura({ factura: anulable(), notasCredito: [nc] }, true)).toBe(false)
  })

  it("con una nota emitida tampoco (aunque la factura figure aun como emitida)", () => {
    expect(puedeAnularFactura({ factura: anulable(), notasCredito: [nota("f1")] }, true)).toBe(false)
  })

  it("una fila sin el campo 'anulable' no se ofrece", () => {
    const sinCampo = anulable() as Partial<ComprobanteFiscalDTO>
    delete sinCampo.anulable
    expect(puedeAnularFactura({ factura: sinCampo as ComprobanteFiscalDTO, notasCredito: [] }, true)).toBe(false)
  })
})

describe("notaCreditoPorVerificar", () => {
  it("devuelve la nota pendiente que se puede consultar a ARCA", () => {
    const nc = nota("f1", { id: "n1", estado: "pendiente", verificable: true })
    expect(notaCreditoPorVerificar({ factura: factura({ id: "f1" }), notasCredito: [nc] })).toBe(nc)
  })

  it("una pendiente que el servidor no marca como verificable no se ofrece", () => {
    const nc = nota("f1", { estado: "pendiente", verificable: false })
    expect(notaCreditoPorVerificar({ factura: factura({ id: "f1" }), notasCredito: [nc] })).toBeNull()
  })

  it("una pendiente de una respuesta sin el campo 'verificable' tampoco se ofrece", () => {
    const sinCampo = nota("f1", { estado: "pendiente" }) as Partial<ComprobanteFiscalDTO>
    delete sinCampo.verificable
    expect(
      notaCreditoPorVerificar({ factura: factura({ id: "f1" }), notasCredito: [sinCampo as ComprobanteFiscalDTO] })
    ).toBeNull()
  })

  it("una nota emitida no hace falta verificarla", () => {
    const nc = nota("f1", { estado: "emitido", verificable: true })
    expect(notaCreditoPorVerificar({ factura: factura({ id: "f1" }), notasCredito: [nc] })).toBeNull()
  })

  it("sin notas no hay nada que verificar", () => {
    expect(notaCreditoPorVerificar({ factura: factura({ id: "f1" }), notasCredito: [] })).toBeNull()
  })
})
