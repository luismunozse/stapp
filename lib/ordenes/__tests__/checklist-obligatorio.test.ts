import { describe, it, expect } from "vitest"
import { esPcDeEscritorio } from "../checklist-obligatorio"

describe("esPcDeEscritorio", () => {
  it("Computadora con Tipo de PC = Desktop", () => {
    expect(esPcDeEscritorio({ tipoNombre: "Computadora", tipoPc: "Desktop" })).toBe(true)
  })

  it("tipo de equipo propio llamado PC de escritorio", () => {
    expect(esPcDeEscritorio({ tipoNombre: "PC de Escritorio" })).toBe(true)
  })

  it("notebook y all-in-one siguen con el checklist obligatorio", () => {
    expect(esPcDeEscritorio({ tipoNombre: "Computadora", tipoPc: "Notebook" })).toBe(false)
    expect(esPcDeEscritorio({ tipoNombre: "Computadora", tipoPc: "All-in-One" })).toBe(false)
  })

  it("sin Tipo de PC elegido o con otro tipo de equipo", () => {
    expect(esPcDeEscritorio({ tipoNombre: "Computadora" })).toBe(false)
    expect(esPcDeEscritorio({ tipoNombre: "Celular", tipoPc: undefined })).toBe(false)
    expect(esPcDeEscritorio({})).toBe(false)
  })
})
