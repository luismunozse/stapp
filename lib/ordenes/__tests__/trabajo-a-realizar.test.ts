import { describe, it, expect } from "vitest"
import { joinTrabajosARealizar, parseTrabajosARealizar } from "@/lib/ordenes/trabajo-a-realizar"

describe("trabajo a realizar: varios trabajos en una columna", () => {
  it("separa por línea y descarta vacíos", () => {
    expect(parseTrabajosARealizar("Cambio de pantalla\n\n  Cambio de batería  \r\n")).toEqual([
      "Cambio de pantalla",
      "Cambio de batería",
    ])
  })

  it("un texto viejo de un solo trabajo sigue siendo un trabajo", () => {
    expect(parseTrabajosARealizar("Cambio de batería")).toEqual(["Cambio de batería"])
  })

  it("vacío o null es una lista vacía", () => {
    expect(parseTrabajosARealizar(null)).toEqual([])
    expect(parseTrabajosARealizar("")).toEqual([])
  })

  it("une por línea y devuelve null si no queda ninguno", () => {
    expect(joinTrabajosARealizar(["Cambio de pantalla", " ", "Cambio de batería"])).toBe(
      "Cambio de pantalla\nCambio de batería",
    )
    expect(joinTrabajosARealizar(["", "  "])).toBeNull()
  })
})
