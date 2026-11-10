import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Guard arquitectónico: el editor de fecha prometida tiene que respetar el
// mismo permiso que el PUT de /api/ordenes/[id]. Un técnico con
// `tecnicos_toman_ordenes` puede ABRIR una orden sin asignar (GET), pero el PUT
// le devuelve 403: si el lápiz aparece, edita, guarda y recibe un error.
//
// Chequeo sobre el fuente por la misma razón que orden-detail-tabs-gating:
// montar OrdenDetail arrastra sesión, router y una cascada de fetch.

const SRC = readFileSync(
  join(process.cwd(), "components", "ordenes", "orden-detail.tsx"),
  "utf8",
)

describe("OrdenDetail — gate del editor de fecha prometida", () => {
  it("todas las instancias pasan el handler solo si el usuario puede editar", () => {
    const usos = SRC.match(/onUpdateFechaPrometida=\{[^}]*\}/g) ?? []
    expect(usos.length).toBeGreaterThan(0)
    for (const uso of usos) {
      expect(uso).toMatch(/canEditFechaPrometida\s*\?\s*handleSaveFechaPrometida\s*:\s*undefined/)
    }
  })

  it("el gate replica el guard del PUT: TECNICO solo en órdenes asignadas a él", () => {
    const def = SRC.match(/const canEditFechaPrometida\s*=([^\n]*)/)
    expect(def).not.toBeNull()
    expect(def![1]).toContain('"TECNICO"')
    expect(def![1]).toMatch(/tecnicoId\s*===\s*session\?\.user\?\.id/)
  })
})
