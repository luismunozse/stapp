// @vitest-environment node
import { describe, it, expect } from "vitest"
import { TERMINOS, articuloIndefinido, minusculaInicial, resolveTerminologia, t } from "@/lib/terminologia"

describe("resolveTerminologia", () => {
  it("sin overrides => todos los defaults", () => {
    const map = resolveTerminologia(null)
    expect(map.equipo).toBe("Equipo")
    expect(map.orden).toBe("Orden de trabajo")
    expect(map.serie).toBe("Número de serie")
    // todas las keys del catálogo presentes
    for (const def of TERMINOS) expect(map[def.key]).toBeTruthy()
  })

  it("override válido pisa el default; vacío/whitespace cae al default", () => {
    const map = resolveTerminologia({ equipo: "Vehículo", serie: "   ", modelo: "" })
    expect(map.equipo).toBe("Vehículo")
    expect(map.serie).toBe("Número de serie")
    expect(map.modelo).toBe("Modelo")
  })

  it("ignora claves desconocidas del JSON de la DB", () => {
    const map = resolveTerminologia({ hackeo: "x", equipo: "Bici" } as any)
    expect(map.equipo).toBe("Bici")
    expect((map as any).hackeo).toBeUndefined()
  })
})

describe("t", () => {
  it("devuelve el valor o la propia key si no existe", () => {
    const map = resolveTerminologia(null)
    expect(t(map, "equipo")).toBe("Equipo")
    expect(t(map, "inexistente")).toBe("inexistente")
  })
})

describe("articuloIndefinido", () => {
  it.each([
    ["Equipo", "un"],
    ["Vehículo", "un"],
    ["Artefacto", "un"],
    ["Rodado", "un"],
    ["Reloj", "un"],
    ["Pieza", "una"],
    ["pieza", "una"],
    ["Máquina de café", "una"],
    ["Cortadora de pasto", "una"],
    ["Instalación eléctrica", "una"],
    ["Unidad", "una"],
    ["Moto", "una"],
    ["Bici", "una"],
    ["Sistema de riego", "un"],
    ["  Persiana  ", "una"],
  ])("%s -> %s", (termino, esperado) => {
    expect(articuloIndefinido(termino)).toBe(esperado)
  })
})

describe("minusculaInicial", () => {
  it.each([
    ["Pieza", "pieza"],
    ["Equipo", "equipo"],
    ["Máquina de café", "máquina de café"],
    ["TV", "TV"],
    ["TV LED", "TV LED"],
    ["PC", "PC"],
    ["pieza", "pieza"],
    ["A", "a"],
    ["", ""],
    ["  Pieza", "  Pieza"],
  ])("%j -> %j", (termino, esperado) => {
    expect(minusculaInicial(termino)).toBe(esperado)
  })
})
