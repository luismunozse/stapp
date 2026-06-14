import { describe, it, expect } from "vitest"
import { resolvePlantillaForTipo } from "@/lib/notifications/whatsapp-message"

const ctx = (orden: Record<string, unknown> = {}) => ({
  organizationName: "GuruTech",
  organizationSlug: "gurutech",
  moneda: "ARS",
  cliente: { id: "c1", nombre: "Juan", telefono: "1100000000" },
  orden: { id: "o1", numeroOrden: 50, dispositivo: "iPhone 12", estado: "PRESUPUESTADO", presupuesto: 15000, publicToken: "tok", ...orden },
})

describe("resolvePlantillaForTipo (catálogo como fuente de verdad)", () => {
  it("CAMBIO_ESTADO sin override → default del catálogo per-estado (accionable + link)", () => {
    const m = resolvePlantillaForTipo("CAMBIO_ESTADO", ctx({ estado: "PRESUPUESTADO" }), null)!
    expect(m).toMatch(/apruebe o rechace/i)
    expect(m).toMatch(/seguimiento\/tok/)
  })

  it("override per-estado gana sobre el default", () => {
    const m = resolvePlantillaForTipo("CAMBIO_ESTADO", ctx({ estado: "RECIBIDO" }), {
      orden_estado_recibido: "Custom recibido {numero_orden}",
    })!
    expect(m).toBe("Custom recibido 50")
  })

  it("PRESUPUESTO_DEFINIDO sin override → default orden_presupuesto con monto + CTA", () => {
    const m = resolvePlantillaForTipo("PRESUPUESTO_DEFINIDO", ctx({ presupuesto: 20000 }), null)!
    expect(m).toMatch(/apruebe o rechace/i)
    expect(m).toMatch(/seguimiento\/tok/)
  })

  it("tipo desconocido sin catálogo → null", () => {
    expect(resolvePlantillaForTipo("NO_EXISTE", ctx(), null)).toBeNull()
  })
})
