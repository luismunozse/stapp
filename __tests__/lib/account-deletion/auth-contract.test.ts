// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Check SECUNDARIO. El comportamiento real está en state.test.ts (isLoginBlocked).
// lib/auth.ts no se puede importar en vitest (next-auth no carga y está mockeado
// globalmente), así que acá solo se fija por texto que cada puerta de entrada
// llama al predicado. Si alguien agrega un cuarto modo de login, este test es el recordatorio.
// La validación del refresh token vive en lib/auth-tokens.ts (testeable); se lee junto con lib/auth.ts.
const src = ["lib/auth.ts", "lib/auth-tokens.ts"]
  .map((f) => readFileSync(join(process.cwd(), f), "utf8"))
  .join("\n")
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

describe("lib/auth.ts decide el superadmin con la marca de la fila (397)", () => {
  it("todas las puertas de entrada usan esSuperadmin, ninguna solo el email", () => {
    expect(count(/const isSuper = esSuperadmin\(/g)).toBe(2)
    expect(count(/const isGoogleSuper = esSuperadmin\(/g)).toBe(1)
    expect(count(/isSuper: esSuperadmin\(/g)).toBe(1)
    expect(count(/const isSuper(?:Google)? = isSuperadminEmail\(/g)).toBe(0)
  })

  it("los SELECT que no usan * piden es_superadmin y acceso_bloqueado_at", () => {
    expect(count(/acceso_bloqueado_at,\s*es_superadmin/g)).toBeGreaterThanOrEqual(1)
    expect(count(/avatar_url,\s*es_superadmin/g)).toBe(1)
  })
})

