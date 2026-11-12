import { describe, it, expect } from "vitest"
import {
  ESTADO_ORDEN_UI,
  ESTADOS_ORDEN,
  getEstadoOrdenUi,
  getEstadoOrdenLabel,
  esEstadoOrden,
  ordenesPorEstadoChartData,
} from "@/lib/estado-orden-ui"
import { STATUS_TONES, STATUS_TONE_HEX } from "@/lib/status-tone"
import { ESTADO_LABELS, TRANSICIONES_VALIDAS } from "@/lib/orden-state-machine"

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe("ESTADO_ORDEN_UI", () => {
  it("cubre todos los estados de la máquina de estados", () => {
    expect(new Set(ESTADOS_ORDEN)).toEqual(new Set(Object.keys(TRANSICIONES_VALIDAS)))
    // SIN_FALLA_DETECTADA faltaba en el gráfico del dashboard.
    expect(ESTADOS_ORDEN).toContain("SIN_FALLA_DETECTADA")
  })

  it("cada estado tiene etiqueta, ícono, tono válido y color de gráfico hex", () => {
    for (const estado of ESTADOS_ORDEN) {
      const ui = ESTADO_ORDEN_UI[estado]
      expect(ui.label.length).toBeGreaterThan(0)
      expect(ui.labelCliente.length).toBeGreaterThan(0)
      expect(ui.icon).toBeTruthy()
      expect(STATUS_TONES).toContain(ui.tone)
      expect(ui.chartColor).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it("los colores de gráfico no se repiten (cada porción se distingue)", () => {
    const colores = ESTADOS_ORDEN.map((e) => ESTADO_ORDEN_UI[e].chartColor.toLowerCase())
    expect(new Set(colores).size).toBe(colores.length)
  })

  it("etiquetas en oración y con tildes", () => {
    expect(ESTADO_ORDEN_UI.EN_REPARACION.label).toBe("En reparación")
    expect(ESTADO_ORDEN_UI.EN_DIAGNOSTICO.label).toBe("En diagnóstico")
    expect(ESTADO_ORDEN_UI.REPARADO.labelCliente).toBe("Listo para retirar")
  })

  it("ESTADO_LABELS de la máquina de estados sale de la misma fuente", () => {
    for (const estado of ESTADOS_ORDEN) {
      expect(ESTADO_LABELS[estado]).toBe(ESTADO_ORDEN_UI[estado].label)
    }
  })
})

describe("getEstadoOrdenUi", () => {
  it("tolera mayúsculas y espacios", () => {
    expect(getEstadoOrdenUi(" en_reparacion ").label).toBe("En reparación")
  })

  it("un estado desconocido sale neutro con el código crudo", () => {
    const ui = getEstadoOrdenUi("RARO")
    expect(ui.tone).toBe("neutral")
    expect(ui.label).toBe("RARO")
    expect(getEstadoOrdenLabel(null)).toBe("")
  })

  it("esEstadoOrden distingue estados válidos", () => {
    expect(esEstadoOrden("REPARADO")).toBe(true)
    expect(esEstadoOrden("toString")).toBe(false)
  })
})

describe("ordenesPorEstadoChartData", () => {
  it("cada porción usa la etiqueta y el color del estado, en el orden del flujo", () => {
    const data = ordenesPorEstadoChartData({ ENTREGADO: 2, RECIBIDO: 5, SIN_FALLA_DETECTADA: 1, EN_REPARACION: 3 })
    expect(data.map((d) => d.estado)).toEqual(["RECIBIDO", "EN_REPARACION", "ENTREGADO", "SIN_FALLA_DETECTADA"])
    for (const d of data) {
      expect(d.name).toBe(ESTADO_ORDEN_UI[d.estado].label)
      expect(d.color).toBe(ESTADO_ORDEN_UI[d.estado].chartColor)
    }
  })

  it("En reparación es naranja como la píldora (antes cian, el color de Reparado)", () => {
    const [d] = ordenesPorEstadoChartData({ EN_REPARACION: 1 })
    expect(ESTADO_ORDEN_UI.EN_REPARACION.tone).toBe("orange")
    expect(d.color).toBe(ESTADO_ORDEN_UI.EN_REPARACION.chartColor)
    expect(d.color).not.toBe(ESTADO_ORDEN_UI.REPARADO.chartColor)
  })

  it("incluye SIN_FALLA_DETECTADA y omite los estados sin órdenes", () => {
    const data = ordenesPorEstadoChartData({ SIN_FALLA_DETECTADA: 4, CANCELADO: 0 })
    expect(data).toEqual([
      { estado: "SIN_FALLA_DETECTADA", name: "Sin falla detectada", value: 4, color: ESTADO_ORDEN_UI.SIN_FALLA_DETECTADA.chartColor },
    ])
    expect(ordenesPorEstadoChartData({})).toEqual([])
  })
})

describe("STATUS_TONE_HEX", () => {
  it("todos los pares texto/fondo cumplen AA (≥4,5:1)", () => {
    for (const tone of STATUS_TONES) {
      const { fg, bg } = STATUS_TONE_HEX[tone]
      expect(contraste(fg, bg), tone).toBeGreaterThanOrEqual(4.5)
    }
  })
})
