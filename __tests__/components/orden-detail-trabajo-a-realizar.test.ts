import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Guard estructural (montar OrdenDetail arrastra sesion, router y una cascada
// de fetch; ver orden-detail-tabs-gating.test.ts): "Trabajo a realizar" se
// edita en el mismo lugar que el problema reportado y guarda por PUT con
// `trabajoARealizar` (la API normaliza vacio a null).
const SRC = readFileSync(join(process.cwd(), "components", "ordenes", "orden-detail.tsx"), "utf8")

describe("OrdenDetail - trabajo a realizar", () => {
  it("lo muestra como campo editable debajo del problema reportado", () => {
    const problema = SRC.indexOf('label="Problema Reportado"')
    const trabajo = SRC.indexOf('label="Trabajo a realizar"')
    expect(problema).toBeGreaterThan(-1)
    expect(trabajo).toBeGreaterThan(problema)
    expect(SRC).toMatch(/label="Trabajo a realizar"[\s\S]{0,200}onSave=\{handleSaveTrabajo\}/)
  })

  it("guarda trabajoARealizar (null cuando queda vacio)", () => {
    const handler = SRC.slice(SRC.indexOf("const handleSaveTrabajo"), SRC.indexOf("const handleSaveDiagnostico"))
    expect(handler).toContain("next.trim() || null")
    expect(handler).toMatch(/\{ trabajoARealizar: value \}/)
  })

  it("el campo no exige valor (es opcional)", () => {
    const bloque = SRC.slice(SRC.indexOf('label="Trabajo a realizar"'), SRC.indexOf('label="Trabajo a realizar"') + 400)
    expect(bloque).not.toContain("requireValue")
  })
})
