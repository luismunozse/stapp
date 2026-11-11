import { describe, it, expect } from "vitest"
import { resolvePlantillaForTipo } from "@/lib/notifications/whatsapp-message"
import { generateEmailContent } from "@/lib/notifications/send-direct"
import { generateEmailByType } from "@/lib/notifications/email-templates"
import { getPlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { NOTIFICATION_TEMPLATES } from "@/lib/whatsapp/templates"
import { detalleGarantiaCliente, venceTextoCliente } from "@/lib/garantias/aviso-texto"

const base = {
  organizationName: "GuruTech",
  organizationSlug: "gurutech",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  cliente: { id: "c1", nombre: "Ana", email: "ana@test.com", telefono: "1100000000" },
}

describe("REINGRESO_GARANTIA: el texto coincide con la orden que se le pasa", () => {
  // lib/garantias/reingreso.ts encola el aviso con la orden NUEVA (la del re-ingreso).
  const ctx = {
    ...base,
    orden: { id: "o-nueva", numeroOrden: 501, dispositivo: "iPhone 12", estado: "RECIBIDO", publicToken: "tok-nueva" },
    garantia: { id: "g1", diasValidez: 90, fechaVencimiento: "2026-12-31T12:00:00Z" },
  }

  it("el WhatsApp (catálogo) no llama \"original\" a la orden de re-ingreso", () => {
    const m = resolvePlantillaForTipo("REINGRESO_GARANTIA", ctx, null)!
    expect(m).not.toMatch(/original/i)
    expect(m).toContain("Orden de re-ingreso #501")
    expect(m).toContain("reingresó")
    expect(m).toContain("/seguimiento/tok-nueva")
    expect(getPlantilla("garantia_reingreso")!.defaultText).not.toMatch(/original/i)
  })

  it("el email de la cola tampoco", () => {
    const { html } = generateEmailContent("REINGRESO_GARANTIA", ctx as any)
    expect(html).not.toMatch(/original/i)
    expect(html).toContain("Orden de re-ingreso:</strong> #501")
  })

  it("las plantillas del envío manual y de Meta no dicen \"Orden original\"", () => {
    const { html } = generateEmailByType("REINGRESO_GARANTIA", { ...ctx, organizationId: "org-1" } as any)!
    expect(html).not.toMatch(/Orden original/i)
    const meta = NOTIFICATION_TEMPLATES.REINGRESO_GARANTIA.getFallbackText({
      clienteNombre: "Ana",
      dispositivo: "iPhone 12",
      numeroOrden: 501,
      organizationName: "GuruTech",
    })
    expect(meta).toContain("orden de re-ingreso #501")
  })
})

describe("GARANTIA_POR_VENCER", () => {
  const reparacion = {
    ...base,
    orden: { id: "o1", numeroOrden: 42, dispositivo: "iPhone 12", estado: "ENTREGADO", publicToken: "tok" },
    garantia: {
      id: "g1",
      diasValidez: 90,
      fechaVencimiento: "2026-11-15T12:00:00Z",
      origen: "REPARACION" as const,
      diasRestantes: 4,
    },
  }
  const venta = {
    ...base,
    garantia: {
      id: "gv1",
      diasValidez: 30,
      fechaVencimiento: "2026-11-11T12:00:00Z",
      origen: "VENTA" as const,
      descripcion: "Auriculares <BT>",
      numeroGarantia: "G-0001",
      diasRestantes: 0,
    },
  }

  it("detalle y vencimiento en castellano rioplatense", () => {
    expect(detalleGarantiaCliente(reparacion.garantia, reparacion.orden)).toBe("la reparación de tu iPhone 12 (orden #42)")
    expect(detalleGarantiaCliente(venta.garantia, null)).toBe("tu Auriculares <BT> (certificado G-0001)")
    expect(venceTextoCliente(4)).toBe("vence en 4 días")
    expect(venceTextoCliente(1)).toBe("vence mañana")
    expect(venceTextoCliente(0)).toBe("vence hoy")
  })

  it("WhatsApp de una reparación: voseo, fecha, link de seguimiento", () => {
    const m = resolvePlantillaForTipo("GARANTIA_POR_VENCER", reparacion, null)!
    expect(m).toContain("Hola Ana")
    expect(m).toContain("la garantía de la reparación de tu iPhone 12 (orden #42) vence en 4 días (el 15/11/2026)")
    expect(m).toContain("acercate")
    expect(m).toContain("/seguimiento/tok")
  })

  it("WhatsApp de una venta: sin orden ni link", () => {
    const m = resolvePlantillaForTipo("GARANTIA_POR_VENCER", venta, null)!
    expect(m).toContain("tu Auriculares <BT> (certificado G-0001) vence hoy")
    expect(m).not.toContain("seguimiento")
    expect(m).not.toMatch(/\n{3,}/)
  })

  it("respeta la plantilla propia de la org", () => {
    const m = resolvePlantillaForTipo("GARANTIA_POR_VENCER", venta, { garantia_por_vencer: "Ojo {cliente}: {garantia_vence}" })
    expect(m).toBe("Ojo Ana: vence hoy")
  })

  it("email de la cola: asunto con la fecha y HTML escapado", () => {
    const { subject, html } = generateEmailContent("GARANTIA_POR_VENCER", venta as any)
    expect(subject).toBe("Tu garantía vence el 11/11/2026")
    expect(html).toContain("Auriculares &lt;BT&gt;")
    expect(html).not.toContain("<BT>")
    expect(html).toContain("acercate")
  })

  it("email del servicio manual también existe", () => {
    const r = generateEmailByType("GARANTIA_POR_VENCER", { ...reparacion, organizationId: "org-1" } as any)
    expect(r?.subject).toBe("Tu garantía vence el 15/11/2026")
  })
})
