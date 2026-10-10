// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Check SECUNDARIO. El comportamiento real está en state.test.ts (isLoginBlocked).
// lib/auth.ts no se puede importar en vitest (next-auth no carga y está mockeado
// globalmente), así que acá solo se fija por texto que cada puerta de entrada
// llama al predicado. Si alguien agrega un cuarto modo de login, este test es el recordatorio.
const src = readFileSync(join(process.cwd(), "lib/auth.ts"), "utf8")
const count = (re: RegExp) => (src.match(re) ?? []).length

describe("lib/auth.ts rechaza cuentas dadas de baja", () => {
  it("usa isLoginBlocked en refresh token, Google y credenciales", () => {
    expect(count(/isLoginBlocked\(/g)).toBeGreaterThanOrEqual(3)
  })

  it("chequea users.deleted_at antes de los chequeos de Google y credenciales", () => {
    expect(count(/isUserDeleted\(/g)).toBeGreaterThanOrEqual(2)
  })

  it("los SELECT de usuario y organización piden deleted_at", () => {
    expect(count(/organizations \(id, activo, deleted_at\)/g)).toBe(1)
    expect(count(/id,\s*activo,\s*deleted_at/g)).toBeGreaterThanOrEqual(3)
  })
})
