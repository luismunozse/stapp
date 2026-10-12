// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  etiquetaRubro,
  marcasParaPractica,
  pasoInicial,
  problemasParaPractica,
  subPasoPractica,
} from "@/components/onboarding/wizard/wizard-state"
import { PRACTICA_PROBLEMAS_GENERICOS, type PracticaOrden } from "@/lib/onboarding/practica-shared"

function practica(estado: PracticaOrden["estado"]): PracticaOrden {
  return {
    id: "prac-1",
    estado,
    publicToken: "tok-123",
    tipoDispositivo: "HELADERA",
    dispositivo: "Gafa",
    problemaReportado: "No enfría",
    costoFinal: null,
  }
}

describe("wizard resume", () => {
  it("starts at the welcome without a practice", () => {
    expect(pasoInicial(null)).toBe("bienvenida")
    expect(subPasoPractica(null)).toBe("recibir")
  })

  it.each([
    ["RECIBIDO", "practica", "reparar"],
    ["REPARADO", "practica", "entregar"],
    ["ENTREGADO_SIN_COBRO", "listo", "terminada"],
  ] as const)("a practice in %s resumes at %s / %s", (estado, paso, sub) => {
    expect(pasoInicial(practica(estado))).toBe(paso)
    expect(subPasoPractica(practica(estado))).toBe(sub)
  })
})

describe("etiquetaRubro", () => {
  it("uses the pack name for a curated rubro", () => {
    expect(etiquetaRubro("electrodomesticos", null)).toBe("Electrodomésticos y refrigeración")
  })

  it("uses the trade text for genérico", () => {
    expect(etiquetaRubro("generico", "máquinas de café")).toBe("Máquinas de café")
  })

  it("falls back to the genérico name without text or with an unknown rubro", () => {
    expect(etiquetaRubro("generico", "   ")).toBe("Otro servicio técnico")
    expect(etiquetaRubro("inexistente", null)).toBe("Otro servicio técnico")
  })
})

describe("practice suggestions", () => {
  it("uses the tipo's own problems, trimmed, deduplicated and capped at 6", () => {
    const tipo = {
      codigo: "X",
      nombre: "X",
      marcas: [],
      problemasComunes: ["A", "A", " B ", "C", "D", "E", "F", "G"],
    }
    expect(problemasParaPractica(tipo)).toEqual(["A", "B", "C", "D", "E", "F"])
  })

  it("falls back to the generic problems when the tipo has none", () => {
    const tipo = { codigo: "X", nombre: "X", marcas: [], problemasComunes: [] }
    expect(problemasParaPractica(tipo)).toEqual([...PRACTICA_PROBLEMAS_GENERICOS])
    expect(problemasParaPractica(undefined)).toEqual([...PRACTICA_PROBLEMAS_GENERICOS])
  })

  it("brands are trimmed, deduplicated and capped at 8", () => {
    const tipo = {
      codigo: "X",
      nombre: "X",
      marcas: ["Gafa", "Gafa", " ", "B", "C", "D", "E", "F", "G", "H", "I"],
      problemasComunes: [],
    }
    expect(marcasParaPractica(tipo)).toEqual(["Gafa", "B", "C", "D", "E", "F", "G", "H"])
    expect(marcasParaPractica(undefined)).toEqual([])
  })
})
