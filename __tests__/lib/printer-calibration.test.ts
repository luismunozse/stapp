// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  generateColumnsTest, generateCodepageTest, generateCutTest, generateSampleTicket,
  wizardReducer, type WizardState,
  COLUMNAS_CANDIDATAS, CODEPAGE_CANDIDATAS,
} from "@/lib/printer-calibration"
import { defaultProfile } from "@/lib/thermal-paper"

function containsSeq(haystack: number[], needle: number[]): boolean {
  return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b))
}
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe("generateColumnsTest", () => {
  it("imprime una regla de exactamente N chars terminada en | por cada candidata", () => {
    const bytes = Array.from(generateColumnsTest())
    for (const n of COLUMNAS_CANDIDATAS) {
      // regla: "123456789.123..." recortada a n-1 + "|"
      let regla = ""
      while (regla.length < n - 1) regla += "123456789."
      regla = regla.slice(0, n - 1) + "|"
      expect(regla).toHaveLength(n)
      expect(containsSeq(bytes, [...ascii(regla), 0x0a])).toBe(true)
    }
  })
})

describe("generateCodepageTest", () => {
  it("selecciona la tabla de cada candidata ANTES de su linea (par ESC t + texto)", () => {
    const bytes = Array.from(generateCodepageTest())
    // cp437(0), cp850(2), cp858(19), win1252(16), en ese orden
    for (const [i, n] of [0, 2, 19, 16].entries()) {
      const idx = bytes.findIndex((_, k) => bytes[k] === 0x1b && bytes[k + 1] === 0x74 && bytes[k + 2] === n)
      expect(idx, `ESC t ${n}`).toBeGreaterThan(-1)
      // el numero de linea "N)" viene despues del selector de SU tabla
      expect(containsSeq(bytes.slice(idx), ascii(`${i + 1})`))).toBe(true)
    }
  })

  it("termina restaurando cp858 (el default del motor)", () => {
    const bytes = Array.from(generateCodepageTest())
    const last = bytes.lastIndexOf(0x74)
    expect(bytes[last + 1]).toBe(19)
  })
})

describe("generateCutTest", () => {
  it("bloque 1 corta con GS V y bloque 2 con ESC i", () => {
    const bytes = Array.from(generateCutTest())
    const gsv = bytes.findIndex((_, k) => bytes[k] === 0x1d && bytes[k + 1] === 0x56)
    const esci = bytes.findIndex((_, k) => bytes[k] === 0x1b && bytes[k + 1] === 0x69)
    expect(gsv).toBeGreaterThan(-1)
    expect(esci).toBeGreaterThan(gsv) // primero gsv, despues esci
  })
})

describe("generateSampleTicket", () => {
  it("usa el generador real de ordenes con el perfil dado", () => {
    const bytes = Array.from(generateSampleTicket({ ...defaultProfile(80), codepage: "win1252" }))
    expect(containsSeq(bytes, [0x1b, 0x74, 16])).toBe(true)
  })
})

describe("wizardReducer", () => {
  const inicio: WizardState = { step: "conexion", profile: defaultProfile() }

  it("conectado avanza a columnas", () => {
    expect(wizardReducer(inicio, { type: "conectado" }).step).toBe("columnas")
  })

  it("elegir columnas fija columnas, deriva ancho (32→58, 42/48→80) y avanza", () => {
    const s = wizardReducer({ ...inicio, step: "columnas" }, { type: "columnas", columnas: 32 })
    expect(s.profile).toMatchObject({ columnas: 32, ancho: 58 })
    expect(s.step).toBe("acentos")
    const s2 = wizardReducer({ ...inicio, step: "columnas" }, { type: "columnas", columnas: 42 })
    expect(s2.profile).toMatchObject({ columnas: 42, ancho: 80 })
  })

  it("elegir codepage y corte completan el perfil y llegan a final", () => {
    let s: WizardState = { step: "acentos", profile: defaultProfile() }
    s = wizardReducer(s, { type: "codepage", codepage: "win1252" })
    expect(s.step).toBe("corte")
    s = wizardReducer(s, { type: "corte", corte: "esci" })
    expect(s.step).toBe("final")
    expect(s.profile).toMatchObject({ codepage: "win1252", corte: "esci" })
  })

  it("reiniciar vuelve a conexion conservando el perfil actual", () => {
    const s = wizardReducer({ step: "final", profile: { ...defaultProfile(), columnas: 42 } }, { type: "reiniciar" })
    expect(s.step).toBe("conexion")
    expect(s.profile.columnas).toBe(42)
  })
})
