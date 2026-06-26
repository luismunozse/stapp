import { describe, it, expect } from "vitest"
import { resolvePlantillaForTipo } from "@/lib/notifications/whatsapp-message"

// Path real de las notificaciones automáticas (send-direct.ts):
// CAMBIO_ESTADO con estado RECIBIDO resuelve la plantilla per-estado
// `orden_estado_recibido` del catálogo (sin override de la org).
function ctxRecibido() {
  return {
    organizationName: "AS Tecno",
    organizationSlug: "astecno",
    cliente: { id: "c1", nombre: "Juan", telefono: "111" },
    orden: {
      id: "o1",
      numeroOrden: 6,
      dispositivo: "iPhone 11",
      estado: "RECIBIDO",
      publicToken: "tok123",
    },
  }
}

describe("mensaje de creación (RECIBIDO) — comprobante por default", () => {
  it("incluye el link del comprobante PDF sin override de la org", () => {
    const msg = resolvePlantillaForTipo("CAMBIO_ESTADO", ctxRecibido(), null)
    expect(msg).toContain("Comprobante:")
    expect(msg).toContain("/api/public/ordenes/tok123/pdf")
  })

  it("sigue incluyendo el link de seguimiento", () => {
    const msg = resolvePlantillaForTipo("CAMBIO_ESTADO", ctxRecibido(), null)
    expect(msg).toContain("/seguimiento/tok123")
  })

  it("no agrega comprobante a otros estados (ej. ENTREGADO usa su propia plantilla)", () => {
    const ctx = ctxRecibido()
    ctx.orden.estado = "EN_REPARACION"
    const msg = resolvePlantillaForTipo("CAMBIO_ESTADO", ctx, null)
    // EN_REPARACION no debe traer el comprobante de recepción
    expect(msg).not.toContain("Comprobante: https")
  })
})
