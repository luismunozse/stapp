import { describe, it, expect } from "vitest"
import { resumenDeudaCliente, saldoCuentaDisplay } from "../cliente-deuda-resumen"

describe("resumenDeudaCliente", () => {
  it("shows debt from deudaTotal and no credit when saldo is zero", () => {
    expect(resumenDeudaCliente({ saldo: 0, deudaTotal: 1500 })).toEqual({
      debe: 1500, aFavor: 0, debeTone: "destructive", aFavorTone: "muted",
    })
  })

  it("reports credit only for a positive saldo", () => {
    expect(resumenDeudaCliente({ saldo: 800, deudaTotal: 0 })).toEqual({
      debe: 0, aFavor: 800, debeTone: "muted", aFavorTone: "info",
    })
  })

  it("never shows a negative saldo as credit (fiado is debt)", () => {
    const r = resumenDeudaCliente({ saldo: -2000, deudaTotal: 2000 })
    expect(r.aFavor).toBe(0)
    expect(r.aFavorTone).toBe("muted")
    expect(r.debe).toBe(2000)
    expect(r.debeTone).toBe("destructive")
  })

  it("is muted on both sides when nothing is owed", () => {
    expect(resumenDeudaCliente({ saldo: 0, deudaTotal: 0 })).toEqual({
      debe: 0, aFavor: 0, debeTone: "muted", aFavorTone: "muted",
    })
  })

  it("returns debe null while the debt is still loading", () => {
    const r = resumenDeudaCliente({ saldo: 300, deudaTotal: undefined })
    expect(r.debe).toBeNull()
    expect(r.debeTone).toBe("muted")
    expect(r.aFavor).toBe(300)
  })

  it("treats a missing saldo as zero", () => {
    expect(resumenDeudaCliente({ saldo: undefined, deudaTotal: 10 }).aFavor).toBe(0)
  })
})

describe("saldoCuentaDisplay", () => {
  it("labels a negative saldo as debt with the absolute amount", () => {
    expect(saldoCuentaDisplay(-450)).toEqual({ label: "Debe (fiado)", amount: 450, tone: "destructive" })
  })
  it("labels a positive saldo as available balance", () => {
    expect(saldoCuentaDisplay(450)).toEqual({ label: "Saldo disponible", amount: 450, tone: "info" })
  })
  it("keeps zero muted", () => {
    expect(saldoCuentaDisplay(0)).toEqual({ label: "Saldo disponible", amount: 0, tone: "muted" })
  })
})
