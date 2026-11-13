import { describe, it, expect } from "vitest"
import { refDiagrama, resolverDiagrama, diagramaPorRef } from "../diagramas"

const TIPOS = ["CELULAR", "TABLET", "COMPUTADORA", "CONSOLA", "SMARTWATCH", "IMPRESORA"]

describe("catálogo de diagramas", () => {
  it.each(TIPOS)("resuelve %s a su diagrama", (codigo) => {
    expect(resolverDiagrama(codigo).id).toBe(codigo.toLowerCase())
  })

  it("cae al genérico para tipos desconocidos o vacíos", () => {
    expect(resolverDiagrama("TALADRO").id).toBe("generico")
    expect(resolverDiagrama("TODOS").id).toBe("generico")
    expect(resolverDiagrama(null).id).toBe("generico")
    expect(resolverDiagrama(undefined).id).toBe("generico")
  })

  it("arma la referencia id@version", () => {
    expect(refDiagrama(resolverDiagrama("CELULAR"))).toBe("celular@1")
  })

  it("resuelve por referencia y cae al genérico si no existe", () => {
    expect(diagramaPorRef("celular@1").id).toBe("celular")
    expect(diagramaPorRef("celular@99").id).toBe("generico")
    expect(diagramaPorRef("basura").id).toBe("generico")
  })

  it("todo diagrama tiene al menos 2 vistas y la primera es frente", () => {
    for (const c of [...TIPOS, "OTRO"]) {
      const d = resolverDiagrama(c)
      expect(d.vistas.length).toBeGreaterThanOrEqual(2)
      expect(d.vistas[0].id).toBe("frente")
    }
  })

  it("todo path es un path SVG válido que empieza con M", () => {
    for (const c of [...TIPOS, "OTRO"]) {
      for (const v of resolverDiagrama(c).vistas) {
        expect(v.paths.length).toBeGreaterThan(0)
        for (const p of v.paths) {
          expect(p).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/)
          expect(p.startsWith("M")).toBe(true)
        }
      }
    }
  })
})
