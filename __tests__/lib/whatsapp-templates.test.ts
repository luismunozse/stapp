import { describe, it, expect } from "vitest"
import { getWhatsAppTemplates } from "@/lib/notifications/whatsapp-templates"
import type { NotificationContext } from "@/lib/notifications/types"

const baseCliente = {
  id: "c1",
  nombre: "Juan",
  email: null,
  telefono: "1100000000",
}

function ctxOrden(overrides: Partial<NotificationContext["orden"]> = {}): NotificationContext {
  return {
    organizationId: "org1",
    organizationName: "ACME",
    organizationSlug: "acme",
    cliente: baseCliente,
    orden: {
      id: "o1",
      numeroOrden: 42,
      dispositivo: "iPhone 12",
      estado: "RECIBIDO",
      publicToken: "tok123",
      ...overrides,
    },
  }
}

describe("getWhatsAppTemplates con ctx.orden", () => {
  it("incluye estado_actual y seguimiento siempre", () => {
    const t = getWhatsAppTemplates(ctxOrden())
    const ids = t.map((x) => x.id)
    expect(ids).toContain("estado_actual")
    expect(ids).toContain("seguimiento")
    expect(ids).toContain("solicitud_info")
  })

  it("incluye presupuesto solo si orden.presupuesto truthy", () => {
    expect(getWhatsAppTemplates(ctxOrden({ presupuesto: null })).map((t) => t.id)).not.toContain("presupuesto")
    expect(getWhatsAppTemplates(ctxOrden({ presupuesto: 1000 })).map((t) => t.id)).toContain("presupuesto")
  })

  it("incluye listo_retirar solo si estado === REPARADO", () => {
    expect(getWhatsAppTemplates(ctxOrden({ estado: "RECIBIDO" })).map((t) => t.id)).not.toContain("listo_retirar")
    expect(getWhatsAppTemplates(ctxOrden({ estado: "REPARADO" })).map((t) => t.id)).toContain("listo_retirar")
  })

  it("incluye entrega_completada para ENTREGADO o ENTREGADO_SIN_REPARACION", () => {
    expect(getWhatsAppTemplates(ctxOrden({ estado: "ENTREGADO" })).map((t) => t.id)).toContain("entrega_completada")
    expect(getWhatsAppTemplates(ctxOrden({ estado: "ENTREGADO_SIN_REPARACION" })).map((t) => t.id)).toContain("entrega_completada")
    expect(getWhatsAppTemplates(ctxOrden({ estado: "RECIBIDO" })).map((t) => t.id)).not.toContain("entrega_completada")
  })

  it("NO incluye bienvenida_cliente cuando hay orden (es solo para !ctx.orden)", () => {
    expect(getWhatsAppTemplates(ctxOrden()).map((t) => t.id)).not.toContain("bienvenida_cliente")
  })

  it("incluye seguimiento_presupuesto_rechazado si CANCELADO + estadoAnterior PRESUPUESTADO", () => {
    const ctx = ctxOrden({ estado: "CANCELADO", estadoAnterior: "PRESUPUESTADO" })
    expect(getWhatsAppTemplates(ctx).map((t) => t.id)).toContain("seguimiento_presupuesto_rechazado")
  })

  it("NO incluye seguimiento_presupuesto_rechazado si CANCELADO sin estadoAnterior PRESUPUESTADO", () => {
    const ctx = ctxOrden({ estado: "CANCELADO", estadoAnterior: "EN_REPARACION" })
    expect(getWhatsAppTemplates(ctx).map((t) => t.id)).not.toContain("seguimiento_presupuesto_rechazado")
  })
})

describe("getWhatsAppTemplates sin ctx.orden", () => {
  it("incluye bienvenida_cliente y respuesta_consulta", () => {
    const ctx: NotificationContext = {
      organizationId: "org1",
      organizationName: "ACME",
      cliente: baseCliente,
    }
    const ids = getWhatsAppTemplates(ctx).map((t) => t.id)
    expect(ids).toContain("bienvenida_cliente")
    expect(ids).toContain("respuesta_consulta")
    expect(ids).toContain("mantenimiento_preventivo")
    expect(ids).toContain("felicitacion")
    expect(ids).toContain("cliente_inactivo")
    expect(ids).not.toContain("estado_actual")
  })
})

describe("getWhatsAppTemplates override application", () => {
  it("aplica el override custom al mensaje de estado_actual", () => {
    const override = {
      orden_estado_actual: "CUSTOM {cliente} - {dispositivo} estado: {estado}",
    }
    const t = getWhatsAppTemplates(ctxOrden(), override).find((x) => x.id === "estado_actual")
    expect(t).toBeDefined()
    expect(t!.mensaje).toMatch(/^CUSTOM Juan - iPhone 12 estado:/)
  })

  it("aplica override usando legacy id → catalog key mapping (presupuesto → orden_presupuesto)", () => {
    const override = { orden_presupuesto: "CUSTOM PRESU {cliente} ${presupuesto}" }
    const t = getWhatsAppTemplates(ctxOrden({ presupuesto: 5000 }), override).find(
      (x) => x.id === "presupuesto",
    )
    expect(t).toBeDefined()
    expect(t!.mensaje).toContain("CUSTOM PRESU Juan")
    expect(t!.mensaje).toContain("5.000")
  })

  it("usa default cuando override es vacío o solo whitespace", () => {
    const override = { orden_estado_actual: "   " }
    const t = getWhatsAppTemplates(ctxOrden(), override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toContain("Juan")
    expect(t!.mensaje).not.toBe("   ")
  })

  it("ignora override si plantillasOverride es null", () => {
    const t = getWhatsAppTemplates(ctxOrden(), null).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toContain("Juan")
  })
})

describe("plantilla por estado individual", () => {
  it("usa orden_estado_<estado> si está customizada", () => {
    const override = { orden_estado_recibido: "CUSTOM RECIBIDO: {cliente}" }
    const ctx = ctxOrden({ estado: "RECIBIDO" })
    const t = getWhatsAppTemplates(ctx, override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toBe("CUSTOM RECIBIDO: Juan")
  })

  it("cae a orden_estado_actual si no hay plantilla por estado específico", () => {
    const override = { orden_estado_actual: "GENERICO {estado}" }
    const ctx = ctxOrden({ estado: "RECIBIDO" })
    const t = getWhatsAppTemplates(ctx, override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toContain("GENERICO")
  })

  it("plantilla por estado tiene prioridad sobre la genérica", () => {
    const override = {
      orden_estado_actual: "GENERICO",
      orden_estado_recibido: "ESPECIFICO RECIBIDO",
    }
    const ctx = ctxOrden({ estado: "RECIBIDO" })
    const t = getWhatsAppTemplates(ctx, override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toBe("ESPECIFICO RECIBIDO")
  })

  it("plantilla por estado solo aplica al estado que matchea", () => {
    const override = { orden_estado_recibido: "RECIBIDO ONLY" }
    const ctx = ctxOrden({ estado: "EN_REPARACION" })
    const t = getWhatsAppTemplates(ctx, override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).not.toBe("RECIBIDO ONLY")
  })
})

describe("copy accionable por estado", () => {
  const estadoMsg = (estado: any, extra = {}) =>
    getWhatsAppTemplates(ctxOrden({ estado, ...extra })).find((t) => t.id === "estado_actual")!.mensaje

  it("copy PRESUPUESTADO es accionable (aprobar/rechazar)", () => {
    expect(estadoMsg("PRESUPUESTADO")).toMatch(/apruebe o rechace/i)
  })
  it("copy REPARADO dice listo para retirar", () => {
    expect(estadoMsg("REPARADO")).toMatch(/listo para retirar/i)
  })
  it("copy APROBADO agradece y anuncia cola de reparacion", () => {
    expect(estadoMsg("APROBADO")).toMatch(/cola de reparaci/i)
  })
  it("mensaje de presupuesto incluye monto y CTA aprobar/rechazar", () => {
    const t = getWhatsAppTemplates(ctxOrden({ presupuesto: 1000 })).find((x) => x.id === "presupuesto")!.mensaje
    expect(t).toMatch(/apruebe o rechace/i)
    expect(t).toMatch(/Presupuesto:/i)
  })
})

describe("link_seguimiento / link_pdf en plantillas", () => {
  it("inyecta link_seguimiento basado en organizationSlug + publicToken", () => {
    const override = { orden_estado_actual: "Link: {link_seguimiento}" }
    const t = getWhatsAppTemplates(ctxOrden(), override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toContain("acme.")
    expect(t!.mensaje).toContain("/seguimiento/tok123")
  })

  it("inyecta link_pdf basado en organizationSlug + publicToken", () => {
    const override = { orden_estado_actual: "PDF: {link_pdf}" }
    const t = getWhatsAppTemplates(ctxOrden(), override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toContain("/api/public/ordenes/tok123/pdf")
  })

  it("link vacío si no hay publicToken", () => {
    const override = { orden_estado_actual: "Link:{link_seguimiento}" }
    const ctx = ctxOrden({ publicToken: null })
    const t = getWhatsAppTemplates(ctx, override).find((x) => x.id === "estado_actual")
    expect(t!.mensaje).toBe("Link:")
  })
})
