// @vitest-environment node
import { describe, it, expect } from "vitest"
import { TERMINOS, resolveTerminologia, t } from "@/lib/terminologia"

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
