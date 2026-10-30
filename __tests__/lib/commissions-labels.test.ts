// @vitest-environment node
import { describe, it, expect } from "vitest"
import { COMMISSION_ROLE_LABEL, ORDER_ACCRUAL_HINT, commissionKindLabel } from "@/lib/commissions/types"

describe("commission labels", () => {
  it("an order credit-note adjustment is a 'Nota de crédito'; a sale one keeps 'Devolución'", () => {
    expect(commissionKindLabel("AJUSTE_DEVOLUCION", "ORDEN")).toBe("Nota de crédito")
    expect(commissionKindLabel("AJUSTE_DEVOLUCION", "VENTA")).toBe("Devolución")
    expect(commissionKindLabel("ORIGINAL", "ORDEN")).toBeNull()
  })
  it("every accrual block has a hint and every role a label", () => {
    expect(Object.keys(ORDER_ACCRUAL_HINT).sort()).toEqual(["ESPERA_COBRO", "ESPERA_ENTREGA", "ESPERA_ENTREGA_Y_COBRO", "NO_COMISIONA", "SIN_REPARACION"])
    expect(COMMISSION_ROLE_LABEL.RECEPCION).toBe("Recepción")
  })
})
