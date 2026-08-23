import { describe, it, expect } from "vitest"
import {
  esAdhesionSinCobro,
  venceLaGracia,
  DIAS_GRACIA_PREAPPROVAL,
} from "@/lib/subscriptions/sweep-rules"

const AHORA = new Date("2026-08-22T12:00:00Z")

function hace(dias: number) {
  const d = new Date(AHORA)
  d.setDate(d.getDate() - dias)
  return d.toISOString()
}

describe("esAdhesionSinCobro", () => {
  it("marca la adhesion vieja que nunca cobro", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: null,
        createdAt: hace(20),
        pagosExitosos: 0,
        ahora: AHORA,
      })
    ).toBe(true)
  })

  it("no toca una adhesion recien hecha: puede estar esperando el primer cobro", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: null,
        createdAt: hace(3),
        pagosExitosos: 0,
        ahora: AHORA,
      })
    ).toBe(false)
  })

  it("no toca una adhesion que ya cobro alguna vez", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: null,
        createdAt: hace(60),
        pagosExitosos: 1,
        ahora: AHORA,
      })
    ).toBe(false)
  })

  it("no toca una suscripcion que ya tiene periodo: de esa se ocupa la otra regla", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: hace(30),
        createdAt: hace(60),
        pagosExitosos: 0,
        ahora: AHORA,
      })
    ).toBe(false)
  })

  it("la ventana es la misma que la de la gracia", () => {
    expect(DIAS_GRACIA_PREAPPROVAL).toBe(12)
  })
})

describe("venceLaGracia", () => {
  it("no bloquea mientras MercadoPago sigue reintentando", () => {
    expect(
      venceLaGracia({ tienePreapproval: true, currentPeriodEnd: hace(3), ahora: AHORA })
    ).toBe(false)
  })

  it("bloquea cuando los reintentos ya se agotaron", () => {
    expect(
      venceLaGracia({ tienePreapproval: true, currentPeriodEnd: hace(15), ahora: AHORA })
    ).toBe(true)
  })

  it("sin debito automatico no hay gracia: la fecha vencida significa que no pago", () => {
    expect(
      venceLaGracia({ tienePreapproval: false, currentPeriodEnd: hace(1), ahora: AHORA })
    ).toBe(true)
  })

  it("una suscripcion sin fecha no la decide esta regla", () => {
    expect(
      venceLaGracia({ tienePreapproval: true, currentPeriodEnd: null, ahora: AHORA })
    ).toBe(false)
  })
})
