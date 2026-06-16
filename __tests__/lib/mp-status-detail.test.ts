import { describe, it, expect } from "vitest"
import { getMpRejectionInfo } from "@/lib/mp-status-detail"

describe("getMpRejectionInfo", () => {
  it("mapea high_risk: sugiere cambiar de tarjeta", () => {
    const info = getMpRejectionInfo("cc_rejected_high_risk")
    expect(info.title).toBe("Pago rechazado por seguridad")
    expect(info.canRetrySameCard).toBe(false)
    expect(info.message.length).toBeGreaterThan(0)
  })

  it("mapea card_disabled: sugiere llamar al banco, reintento posible", () => {
    const info = getMpRejectionInfo("cc_rejected_card_disabled")
    expect(info.title).toBe("Tarjeta inhabilitada")
    expect(info.canRetrySameCard).toBe(true)
    expect(info.message).toMatch(/banco/i)
  })

  it("mapea insufficient_amount: no reintentar misma tarjeta", () => {
    expect(getMpRejectionInfo("cc_rejected_insufficient_amount").canRetrySameCard).toBe(false)
  })

  it("errores de datos sugieren corregir y reintentar misma tarjeta", () => {
    for (const d of [
      "cc_rejected_bad_filled_card_number",
      "cc_rejected_bad_filled_date",
      "cc_rejected_bad_filled_security_code",
      "cc_rejected_bad_filled_other",
    ]) {
      expect(getMpRejectionInfo(d).canRetrySameCard).toBe(true)
    }
  })

  it("devuelve fallback genérico para detalle desconocido, null o undefined", () => {
    const fallback = getMpRejectionInfo("algo_que_no_existe")
    expect(fallback.title).toBe("No pudimos procesar el pago")
    expect(getMpRejectionInfo(null).title).toBe(fallback.title)
    expect(getMpRejectionInfo(undefined).title).toBe(fallback.title)
  })
})
