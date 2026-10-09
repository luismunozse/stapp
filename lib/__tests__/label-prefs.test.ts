import { describe, it, expect, beforeEach, vi } from "vitest"
import { LABEL_PREFS_KEY, readLabelPrefs, saveLabelPrefs } from "@/lib/labels/label-prefs"

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe("readLabelPrefs", () => {
  it("sin nada guardado devuelve null", () => {
    expect(readLabelPrefs()).toBeNull()
  })

  it("lee lo guardado", () => {
    saveLabelPrefs({ medium: "sheet", thermalSize: "58mm", sheetSize: "40x25" })
    expect(readLabelPrefs()).toEqual({ medium: "sheet", thermalSize: "58mm", sheetSize: "40x25" })
  })

  it("acepta las medidas nuevas 40x30 y 50x40", () => {
    saveLabelPrefs({ medium: "thermal", thermalSize: "50x40", sheetSize: "40x30" })
    expect(readLabelPrefs()).toEqual({ medium: "thermal", thermalSize: "50x40", sheetSize: "40x30" })
  })

  it("JSON inválido devuelve null sin tirar", () => {
    window.localStorage.setItem(LABEL_PREFS_KEY, "{no es json")
    expect(readLabelPrefs()).toBeNull()
  })

  it("JSON null devuelve null sin tirar", () => {
    window.localStorage.setItem(LABEL_PREFS_KEY, "null")
    expect(readLabelPrefs()).toBeNull()
  })

  it("tamaño inválido cae al default", () => {
    window.localStorage.setItem(
      LABEL_PREFS_KEY,
      JSON.stringify({ medium: "thermal", thermalSize: "999x1", sheetSize: "zzz" }),
    )
    expect(readLabelPrefs()).toEqual({ medium: "thermal", thermalSize: "50x30", sheetSize: "50x30" })
  })

  it("un rollo no es válido como tamaño de hoja", () => {
    window.localStorage.setItem(
      LABEL_PREFS_KEY,
      JSON.stringify({ medium: "sheet", thermalSize: "80mm", sheetSize: "58mm" }),
    )
    expect(readLabelPrefs()).toEqual({ medium: "sheet", thermalSize: "80mm", sheetSize: "50x30" })
  })

  it("medio desconocido cae a térmica", () => {
    window.localStorage.setItem(LABEL_PREFS_KEY, JSON.stringify({ medium: "otro" }))
    expect(readLabelPrefs()?.medium).toBe("thermal")
  })

  it("si localStorage tira, no propaga", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readLabelPrefs()).toBeNull()
  })
})

describe("saveLabelPrefs", () => {
  it("si localStorage tira, no propaga", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    expect(() =>
      saveLabelPrefs({ medium: "thermal", thermalSize: "50x30", sheetSize: "50x30" }),
    ).not.toThrow()
  })
})
