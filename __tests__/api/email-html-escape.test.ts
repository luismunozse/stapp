/**
 * Security regression: stored XSS via client-controlled DB fields in email HTML.
 * Tests that generateEmailContent escapes dangerous characters in every template.
 */
import { describe, it, expect } from "vitest"
import { generateEmailContent } from "@/lib/notifications/send-direct"

const XSS_NAME = '<script>alert(1)</script>'
const XSS_DEVICE = '<img src=x onerror=alert(2)>'
const XSS_ORG = '<b onmouseover=alert(3)>Org</b>'
const XSS_ESTADO = '<em>ROTO</em>'

function baseContext(overrides: Partial<Parameters<typeof generateEmailContent>[1]> = {}): Parameters<typeof generateEmailContent>[1] {
  return {
    organizationName: "Acme Reparaciones",
    organizationSlug: "acme",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    cliente: {
      id: "cli-1",
      nombre: "Juan Pérez",
      email: "juan@example.com",
      telefono: "+54911111111",
    },
    orden: {
      id: "ord-1",
      numeroOrden: 42,
      dispositivo: "iPhone 13",
      estado: "LISTO",
      estadoAnterior: "EN_REPARACION",
      presupuesto: 15000,
      fechaCompletado: null,
      publicToken: null,
      tecnicoId: null,
    },
    garantia: {
      id: "gar-1",
      diasValidez: 90,
      fechaVencimiento: "2026-09-01",
    },
    ...overrides,
  }
}

// Helper: assert that the html does NOT contain a raw XSS payload
function assertNoRawXss(html: string, payload: string, label: string) {
  expect(html, `${label}: raw payload must not appear in html`).not.toContain(payload)
}

// Helper: assert that the html DOES contain the escaped version
function assertEscaped(html: string, escaped: string, label: string) {
  expect(html, `${label}: escaped version must appear in html`).toContain(escaped)
}

describe("generateEmailContent — XSS escaping", () => {
  describe("CAMBIO_ESTADO template", () => {
    it("escapes cliente.nombre", () => {
      const ctx = baseContext({ cliente: { ...baseContext().cliente, nombre: XSS_NAME } })
      const { html } = generateEmailContent("CAMBIO_ESTADO", ctx)
      assertNoRawXss(html, "<script>", "nombre")
      assertEscaped(html, "&lt;script&gt;", "nombre")
    })

    it("escapes orden.dispositivo", () => {
      const ctx = baseContext({ orden: { ...baseContext().orden!, dispositivo: XSS_DEVICE } })
      const { html } = generateEmailContent("CAMBIO_ESTADO", ctx)
      assertNoRawXss(html, "<img", "dispositivo")
      assertEscaped(html, "&lt;img", "dispositivo")
    })

    it("escapes organizationName", () => {
      const ctx = baseContext({ organizationName: XSS_ORG })
      const { html } = generateEmailContent("CAMBIO_ESTADO", ctx)
      assertNoRawXss(html, "<b ", "organizationName")
      assertEscaped(html, "&lt;b ", "organizationName")
    })

    it("escapes orden.estado (passed through formatEstado)", () => {
      const ctx = baseContext({ orden: { ...baseContext().orden!, estado: XSS_ESTADO } })
      const { html } = generateEmailContent("CAMBIO_ESTADO", ctx)
      // The raw <em> tag must not appear unescaped in HTML
      assertNoRawXss(html, "<em>ROTO</em>", "estado")
    })

    it("does not double-escape safe text", () => {
      const ctx = baseContext({ cliente: { ...baseContext().cliente, nombre: "María" } })
      const { html } = generateEmailContent("CAMBIO_ESTADO", ctx)
      expect(html).toContain("María")
    })
  })

  describe("PRESUPUESTO_DEFINIDO template", () => {
    it("escapes cliente.nombre", () => {
      const ctx = baseContext({ cliente: { ...baseContext().cliente, nombre: XSS_NAME } })
      const { html } = generateEmailContent("PRESUPUESTO_DEFINIDO", ctx)
      assertNoRawXss(html, "<script>", "nombre")
      assertEscaped(html, "&lt;script&gt;", "nombre")
    })

    it("escapes orden.dispositivo", () => {
      const ctx = baseContext({ orden: { ...baseContext().orden!, dispositivo: XSS_DEVICE } })
      const { html } = generateEmailContent("PRESUPUESTO_DEFINIDO", ctx)
      assertNoRawXss(html, "<img", "dispositivo")
      assertEscaped(html, "&lt;img", "dispositivo")
    })

    it("escapes organizationName", () => {
      const ctx = baseContext({ organizationName: XSS_ORG })
      const { html } = generateEmailContent("PRESUPUESTO_DEFINIDO", ctx)
      assertNoRawXss(html, "<b ", "organizationName")
      assertEscaped(html, "&lt;b ", "organizationName")
    })
  })

  describe("GARANTIA_CREADA template", () => {
    it("escapes cliente.nombre", () => {
      const ctx = baseContext({ cliente: { ...baseContext().cliente, nombre: XSS_NAME } })
      const { html } = generateEmailContent("GARANTIA_CREADA", ctx)
      assertNoRawXss(html, "<script>", "nombre")
      assertEscaped(html, "&lt;script&gt;", "nombre")
    })

    it("escapes orden.dispositivo", () => {
      const ctx = baseContext({ orden: { ...baseContext().orden!, dispositivo: XSS_DEVICE } })
      const { html } = generateEmailContent("GARANTIA_CREADA", ctx)
      assertNoRawXss(html, "<img", "dispositivo")
      assertEscaped(html, "&lt;img", "dispositivo")
    })

    it("escapes organizationName", () => {
      const ctx = baseContext({ organizationName: XSS_ORG })
      const { html } = generateEmailContent("GARANTIA_CREADA", ctx)
      assertNoRawXss(html, "<b ", "organizationName")
      assertEscaped(html, "&lt;b ", "organizationName")
    })
  })

  describe("RECORDATORIO_RETIRO template", () => {
    it("escapes cliente.nombre", () => {
      const ctx = baseContext({ cliente: { ...baseContext().cliente, nombre: XSS_NAME } })
      const { html } = generateEmailContent("RECORDATORIO_RETIRO", ctx)
      assertNoRawXss(html, "<script>", "nombre")
      assertEscaped(html, "&lt;script&gt;", "nombre")
    })

    it("escapes orden.dispositivo", () => {
      const ctx = baseContext({ orden: { ...baseContext().orden!, dispositivo: XSS_DEVICE } })
      const { html } = generateEmailContent("RECORDATORIO_RETIRO", ctx)
      assertNoRawXss(html, "<img", "dispositivo")
      assertEscaped(html, "&lt;img", "dispositivo")
    })

    it("escapes organizationName", () => {
      const ctx = baseContext({ organizationName: XSS_ORG })
      const { html } = generateEmailContent("RECORDATORIO_RETIRO", ctx)
      assertNoRawXss(html, "<b ", "organizationName")
      assertEscaped(html, "&lt;b ", "organizationName")
    })
  })
})
