import { describe, it, expect } from "vitest"
import { esDestinatarioDeLaCampana } from "@/lib/billing/campana-preapproval"

const PAGADOR = {
  precioMensual: 19999,
  tienePreapproval: false,
  status: "ACTIVE",
  yaRecibioElMail: false,
}

describe("esDestinatarioDeLaCampana", () => {
  it("le manda al que paga a mano", () => {
    expect(esDestinatarioDeLaCampana(PAGADOR)).toBe(true)
  })

  it("no le manda a quien ya tiene debito automatico", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, tienePreapproval: true })).toBe(false)
  })

  it("no le manda a quien esta en un plan gratis", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, precioMensual: 0 })).toBe(false)
  })

  it("no le manda a quien esta en trial: todavia no paga", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, status: "TRIALING" })).toBe(false)
  })

  it("no le manda dos veces a la misma organizacion", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, yaRecibioElMail: true })).toBe(false)
  })

  it("le manda al que se atraso: es a quien mas le sirve", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, status: "PAST_DUE" })).toBe(true)
  })
})
