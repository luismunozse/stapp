import { describe, it, expect } from "vitest"
import { construirMensajeRecepcion } from "@/lib/recepcion-whatsapp"

const params = {
  organizationName: "Taller Central",
  clienteNombre: "Juan",
  codigoRecepcion: "REC001",
  baseUrl: "https://taller.stapp.com",
  ordenes: [
    { codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "aaa111" },
    { codigoOrden: "PC002", dispositivo: "Notebook HP", publicToken: "bbb222" },
  ],
}

describe("construirMensajeRecepcion", () => {
  it("incluye un link de seguimiento por orden", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("https://taller.stapp.com/seguimiento/aaa111")
    expect(msg).toContain("https://taller.stapp.com/seguimiento/bbb222")
  })

  it("nombra cada equipo con su codigo de orden", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("CEL001")
    expect(msg).toContain("iPhone 13")
    expect(msg).toContain("PC002")
    expect(msg).toContain("Notebook HP")
  })

  it("referencia el comprobante del lote y la cantidad de equipos", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("REC001")
    expect(msg).toContain("2")
  })

  it("no genera un mensaje por orden: es uno solo", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg.split("REC001").length - 1).toBe(1)
  })

  it("nombra la empresa en el saludo cuando hay nombre", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("recibimos tus 2 equipos en Taller Central.")
  })

  // POST /api/recepciones puede devolver organizationName null (la org sin
  // nombre_mostrar ni nombre), y el modal lo normaliza a "". El saludo tiene
  // que omitir el "en <empresa>" entero, igual que el comprobante impreso
  // omite la linea del encabezado: nunca "...equipos en ."
  it.each([
    ["vacio", ""],
    ["null", null],
    ["undefined", undefined],
    ["solo espacios", "   "],
  ])("omite la empresa del saludo cuando el nombre viene %s", (_caso, organizationName) => {
    const msg = construirMensajeRecepcion({ ...params, organizationName })
    expect(msg).toContain("recibimos tus 2 equipos.")
    expect(msg).not.toContain("equipos en ")
    expect(msg).not.toContain(" en .")
  })
})
