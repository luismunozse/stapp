import { describe, it, expect } from "vitest"
import { autoSelectSeries } from "../pos-types"

describe("autoSelectSeries", () => {
  const series = [
    { id: "s1", numeroSerie: "A1" },
    { id: "s2", numeroSerie: "A2" },
    { id: "s3", numeroSerie: "A3" },
  ]

  it("toma las primeras N (FIFO ya ordenado)", () => {
    expect(autoSelectSeries(series, 2)).toEqual(["s1", "s2"])
  })

  it("si cantidad excede disponibles, devuelve todas", () => {
    expect(autoSelectSeries(series, 5)).toEqual(["s1", "s2", "s3"])
  })

  it("cantidad 0 devuelve vacío", () => {
    expect(autoSelectSeries(series, 0)).toEqual([])
  })
})
