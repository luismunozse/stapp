import { describe, it, expect } from "vitest"
import { generateWhatsAppMessage } from "@/lib/notifications/whatsapp-message"

const ctx = (orden: Record<string, unknown> = {}) =>
  ({
    organizationName: "GuruTech",
    organizationSlug: "gurutech",
    moneda: "ARS",
    cliente: { id: "c1", nombre: "Juan", telefono: "1100000000" },
    orden: {
      id: "o1",
      numeroOrden: 50,
      dispositivo: "iPhone 12",
      estado: "PRESUPUESTADO",
      publicToken: "tok",
      ...orden,
    },
  }) as any

const msg = (tipo: string, c: unknown) => generateWhatsAppMessage(tipo, c as any)

describe("generateWhatsAppMessage (path automático)", () => {
  it("CAMBIO_ESTADO PRESUPUESTADO: monto + CTA aprobar/rechazar + link", () => {
    const m = msg("CAMBIO_ESTADO", ctx({ estado: "PRESUPUESTADO", presupuesto: 15000 }))
    expect(m).toMatch(/apruebe o rechace/i)
    expect(m).toMatch(/seguimiento\/tok/)
    expect(m).toMatch(/15[.,]000/)
  })

  it("CAMBIO_ESTADO REPARADO: listo para retirar + link", () => {
    const m = msg("CAMBIO_ESTADO", ctx({ estado: "REPARADO" }))
    expect(m).toMatch(/listo para retirar/i)
    expect(m).toMatch(/seguimiento\/tok/)
  })

  it("CAMBIO_ESTADO RECIBIDO: copy específico (no genérico 'cambió a')", () => {
    const m = msg("CAMBIO_ESTADO", ctx({ estado: "RECIBIDO" }))
    expect(m).toMatch(/cola de diagn/i)
    expect(m).not.toMatch(/cambió a/i)
  })

  it("PRESUPUESTO_DEFINIDO: monto + CTA + link, sin 'responda SI'", () => {
    const m = msg("PRESUPUESTO_DEFINIDO", ctx({ presupuesto: 20000 }))
    expect(m).toMatch(/apruebe o rechace/i)
    expect(m).toMatch(/seguimiento\/tok/)
    expect(m).not.toMatch(/responda\s+\*?si\*?/i)
  })

  it("sin publicToken no rompe (link vacío)", () => {
    const m = msg("CAMBIO_ESTADO", ctx({ estado: "EN_REPARACION", publicToken: null }))
    expect(m).toMatch(/en reparaci/i)
    expect(m).not.toMatch(/seguimiento\//)
  })
})
