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
  describe("CAMBIO_ESTADO REPARADO: orden_listo_retirar como override de respaldo", () => {
    const reparado = () => ctx({ estado: "REPARADO" })

    it("solo orden_listo_retirar → se usa (con variables renderizadas)", () => {
      const m = resolvePlantillaForTipo("CAMBIO_ESTADO", reparado(), {
        orden_listo_retirar: "Listo {cliente}, orden {numero_orden}",
      })
      expect(m).toBe("Listo Juan, orden 50")
    })

    it("orden_estado_reparado gana sobre orden_listo_retirar", () => {
      const m = resolvePlantillaForTipo("CAMBIO_ESTADO", reparado(), {
        orden_estado_reparado: "Y {cliente}",
        orden_listo_retirar: "X {cliente}",
      })
      expect(m).toBe("Y Juan")
    })

    it("orden_listo_retirar gana sobre el genérico orden_estado_actual", () => {
      const m = resolvePlantillaForTipo("CAMBIO_ESTADO", reparado(), {
        orden_estado_actual: "Z {cliente}",
        orden_listo_retirar: "X {cliente}",
      })
      expect(m).toBe("X Juan")
    })

    it("sin overrides → default del catálogo de orden_estado_reparado", () => {
      const m = resolvePlantillaForTipo("CAMBIO_ESTADO", reparado(), null)!
      expect(m).toMatch(/se encuentra reparado/)
      expect(m).not.toMatch(/le recordamos/)
    })

    it("no se filtra a otros estados", () => {
      const m = resolvePlantillaForTipo("CAMBIO_ESTADO", ctx({ estado: "EN_REPARACION" }), {
        orden_listo_retirar: "X {cliente}",
      })!
      expect(m).not.toContain("X Juan")
    })

    it("RECORDATORIO_RETIRO sigue usando orden_listo_retirar", () => {
      const m = resolvePlantillaForTipo("RECORDATORIO_RETIRO", reparado(), {
        orden_listo_retirar: "X {cliente}",
      })
      expect(m).toBe("X Juan")
    })
  })
})
