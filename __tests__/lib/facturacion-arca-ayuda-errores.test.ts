import { describe, it, expect } from "vitest"
import {
  ayudaErrorArca,
  ayudaDeMensajes,
  describirErroresArca,
  sistemaPuntoVentaNoCorresponde,
} from "@/lib/facturacion/arca/ayuda-errores"

/**
 * Caso real: un taller pasó de Responsable Inscripto a Monotributo y siguió
 * usando el punto de venta "RECE" de antes. ARCA rechazaba cada factura con
 * "10005: NO AUTORIZADO A EMITIR COMPROBANTES - EL PUNTO DE VENTA INFORMADO
 * DEBE ESTAR DADO DE ALTA Y SER DEL TIPO RECE" y el taller no sabía qué hacer.
 */
const MSG_10005 =
  "NO AUTORIZADO A EMITIR COMPROBANTES - EL PUNTO DE VENTA INFORMADO DEBE ESTAR DADO DE ALTA Y SER DEL TIPO RECE"

describe("ayudaErrorArca", () => {
  it("10005 como Monotributo: indica crear un punto de venta del sistema Monotributo", () => {
    const a = ayudaErrorArca({ code: 10005, msg: MSG_10005 }, "MONOTRIBUTO")
    expect(a).toContain("Factura Electronica - Monotributo - Web Service")
    expect(a).toContain("Monotributo")
    expect(a).toContain("no se puede modificar")
  })

  it("10005 como Responsable Inscripto: indica el sistema RECE", () => {
    expect(ayudaErrorArca({ code: 10005 }, "RESPONSABLE_INSCRIPTO")).toContain("RECE para aplicativo y Web Service")
  })

  it("reconoce por texto aunque el código cambie", () => {
    expect(ayudaErrorArca({ code: 99999, msg: MSG_10005 }, "MONOTRIBUTO")).toContain("punto de venta")
  })

  it("600: delegación", () => {
    expect(ayudaErrorArca({ code: 600, msg: "No aparecio CUIT en lista de relaciones" })).toContain("Administrador de Relaciones")
  })

  it("errores internos de ARCA: no es culpa de la configuración", () => {
    expect(ayudaErrorArca({ code: 501, msg: "Error interno de base de datos" })).toContain("problema de su lado")
  })

  it("un error desconocido no inventa ayuda", () => {
    expect(ayudaErrorArca({ code: 12345, msg: "algo raro" })).toBeNull()
  })
})

describe("describirErroresArca / ayudaDeMensajes", () => {
  it("conserva el texto original de ARCA y agrega la ayuda una sola vez", () => {
    const t = describirErroresArca(
      [
        { code: 10005, msg: MSG_10005 },
        { code: 10005, msg: MSG_10005 },
      ],
      "MONOTRIBUTO"
    )
    expect(t.startsWith(`10005: ${MSG_10005}`)).toBe(true)
    expect(t.match(/Administración de puntos de venta/g)).toHaveLength(1)
  })

  it("parsea mensajes ya armados como 'CODIGO: texto'", () => {
    expect(ayudaDeMensajes([`10005: ${MSG_10005}`], "MONOTRIBUTO")).toContain("Monotributo")
    expect(ayudaDeMensajes(["12345: nada conocido"])).toBeNull()
  })
})

describe("sistemaPuntoVentaNoCorresponde", () => {
  it("RECE usado como Monotributo: no corresponde", () => {
    expect(sistemaPuntoVentaNoCorresponde("CAE - RECE", "MONOTRIBUTO")).toBe(true)
  })
  it("Monotributo usado como Responsable Inscripto: no corresponde", () => {
    expect(sistemaPuntoVentaNoCorresponde("CAE - Monotributo", "RESPONSABLE_INSCRIPTO")).toBe(true)
  })
  it("si coincide o el texto no lo dice, no afirma nada", () => {
    expect(sistemaPuntoVentaNoCorresponde("CAE - Monotributo", "MONOTRIBUTO")).toBe(false)
    expect(sistemaPuntoVentaNoCorresponde("CAE", "MONOTRIBUTO")).toBe(false)
    expect(sistemaPuntoVentaNoCorresponde(undefined, "MONOTRIBUTO")).toBe(false)
  })
})
