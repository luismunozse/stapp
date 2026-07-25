// __tests__/components/print-label.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import {
  buildLabelHtml,
  readEtiquetaSize,
  saveEtiquetaSize,
  DEFAULT_LABEL_SIZE,
  type LabelData,
} from "@/components/ordenes/print-label"

const baseData: LabelData = {
  codigoOrden: "A-1",
  numeroOrden: 1,
  clienteNombre: "Ana",
  dispositivo: "iPhone 12",
  problemaReportado: "No carga",
  fechaIngreso: "01/01/2026",
  variant: "reparado",
  fechaReparacion: "02/01/2026",
}

describe("buildLabelHtml — tamaños y modos", () => {
  it("die-cut 60x40: @page 60mm 40mm", () => {
    expect(buildLabelHtml(baseData, "60x40", "")).toContain("size: 60mm 40mm")
  })

  it("die-cut 40x30: @page 40mm 30mm", () => {
    expect(buildLabelHtml(baseData, "40x30", "")).toContain("size: 40mm 30mm")
  })

  it("rollo 58mm: @page 58mm auto (altura automática)", () => {
    expect(buildLabelHtml(baseData, "58mm", "")).toContain("size: 58mm auto")
  })

  it("rollo 80mm: @page 80mm auto", () => {
    expect(buildLabelHtml(baseData, "80mm", "")).toContain("size: 80mm auto")
  })
})

describe("buildLabelHtml — contenido por variante", () => {
  it("variante reparado muestra el badge REPARADO y 'Listo para entregar'", () => {
    const html = buildLabelHtml(baseData, "60x40", "")
    expect(html).toContain("REPARADO")
    expect(html).toContain("Listo para entregar")
  })

  it("variante ingreso muestra el problema y NO el badge", () => {
    const html = buildLabelHtml({ ...baseData, variant: "ingreso" }, "60x40", "")
    expect(html).not.toContain("REPARADO")
    expect(html).toContain("No carga")
  })

  it("rollo variante reparado también muestra badge y 'Listo para entregar'", () => {
    const html = buildLabelHtml(baseData, "58mm", "")
    expect(html).toContain("REPARADO")
    expect(html).toContain("Listo para entregar")
  })

  it("rollo variante ingreso muestra el problema y NO el badge", () => {
    const html = buildLabelHtml({ ...baseData, variant: "ingreso" }, "80mm", "")
    expect(html).not.toContain("REPARADO")
    expect(html).toContain("No carga")
  })

  it("incluye el QR cuando se pasa un dataUrl", () => {
    const html = buildLabelHtml(baseData, "60x40", "data:image/png;base64,AAA")
    expect(html).toContain("data:image/png;base64,AAA")
  })

  it("siempre incluye cliente y equipo", () => {
    const html = buildLabelHtml(baseData, "58mm", "")
    expect(html).toContain("Ana")
    expect(html).toContain("iPhone 12")
  })
})

describe("persistencia del tamaño en localStorage", () => {
  beforeEach(() => localStorage.clear())

  it("devuelve el default cuando no hay nada guardado", () => {
    expect(readEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
  })

  it("guarda y lee el mismo tamaño (roundtrip)", () => {
    saveEtiquetaSize("58mm")
    expect(readEtiquetaSize()).toBe("58mm")
  })

  it("ignora un valor inválido guardado y cae al default", () => {
    localStorage.setItem("stapp:etiqueta-size", "999x999")
    expect(readEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
  })
})
