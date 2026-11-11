// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  hashRefreshToken,
  saveRefreshToken,
  validateRefreshToken,
  revocarRefreshToken,
  invalidateRefreshToken,
  rotarRefreshToken,
  revalidarTokenSesion,
  REVALIDAR_CADA_SEG,
} from "@/lib/auth-tokens"

/**
 * Fake mínimo de supabaseAdmin para users + refresh_tokens: aplica eq/neq/lt
 * en lecturas y escrituras. Los usuarios traen `organizations` embebido.
 */
type Fila = Record<string, any>
let db: { users: Fila[]; refresh_tokens: Fila[] }
let secuencia = 0

function montar() {
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: "users" | "refresh_tokens") => {
    const filtros: Array<(f: Fila) => boolean> = []
    let op: "select" | "update" | "delete" = "select"
    let carga: Fila | null = null
    const filas = () => db[tabla].filter((f) => filtros.every((p) => p(f)))
    const ejecutar = () => {
      if (op === "delete") {
        const borrar = filas()
        db[tabla] = db[tabla].filter((f) => !borrar.includes(f))
        return { data: borrar, error: null }
      }
      if (op === "update") {
        const tocar = filas()
        tocar.forEach((f) => Object.assign(f, carga))
        return { data: tocar, error: null }
      }
      return { data: filas(), error: null }
    }
    const cadena: any = {
      select: () => cadena,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), cadena),
      neq: (c: string, v: unknown) => (filtros.push((f) => f[c] !== v), cadena),
      lt: (c: string, v: string) => (filtros.push((f) => f[c] < v), cadena),
      update: (v: Fila) => ((op = "update"), (carga = v), cadena),
      delete: () => ((op = "delete"), cadena),
      insert: async (v: Fila) => {
        db[tabla].push({ id: `rt-${++secuencia}`, ...v })
        return { data: null, error: null }
      },
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      single: async () => {
        const [f] = filas()
        return f ? { data: f, error: null } : { data: null, error: { code: "PGRST116" } }
      },
      then: (ok: any, ko: any) => Promise.resolve(ejecutar()).then(ok, ko),
    }
    return cadena
  }) as any)
}

const ORG = { id: "org-1", activo: true, deleted_at: null }
const usuario = (extra: Fila = {}): Fila => ({
  id: "u-1",
  email: "tecnico@taller.test",
  nombre: "Tecnico",
  rol: "TECNICO",
  organization_id: "org-1",
  sucursal_id: "suc-1",
  deleted_at: null,
  refresh_token: null,
  refresh_token_expires: null,
  organizations: ORG,
  ...extra,
})

const enDias = (d: number) => new Date(Date.now() + d * 86400_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  db = { users: [usuario()], refresh_tokens: [] }
  montar()
})

describe("saveRefreshToken", () => {
  it("guarda solo el hash, en una fila por sesión, sin pisar otras sesiones", async () => {
    const a = await saveRefreshToken("u-1", true)
    const b = await saveRefreshToken("u-1", false)

    expect(a).toMatch(/^[0-9a-f]{128}$/)
    expect(db.refresh_tokens.map((r) => r.token_hash)).toEqual([hashRefreshToken(a), hashRefreshToken(b)])
    expect(JSON.stringify(db)).not.toContain(a)
    expect(await validateRefreshToken(a)).not.toBeNull()
    expect(await validateRefreshToken(b)).not.toBeNull()
  })

  it("limpia las sesiones vencidas del usuario", async () => {
    db.refresh_tokens.push({ id: "viejo", user_id: "u-1", token_hash: "0".repeat(64), expires_at: enDias(-1) })
    await saveRefreshToken("u-1", true)
    expect(db.refresh_tokens.map((r) => r.id)).not.toContain("viejo")
  })
})

describe("validateRefreshToken", () => {
  it("rechaza el hash guardado usado como si fuera el token", async () => {
    const t = await saveRefreshToken("u-1", true)
    expect(await validateRefreshToken(hashRefreshToken(t))).toBeNull()
  })

  it("rechaza y borra una sesión vencida", async () => {
    const t = await saveRefreshToken("u-1", true)
    db.refresh_tokens[0].expires_at = enDias(-1)
    expect(await validateRefreshToken(t)).toBeNull()
    expect(db.refresh_tokens).toHaveLength(0)
  })

  it("acepta un token previo a la tabla mientras no venza", async () => {
    const legado = "f".repeat(128)
    db.users[0].refresh_token = legado
    db.users[0].refresh_token_expires = enDias(3)
    const u = await validateRefreshToken(legado)
    expect(u?.id).toBe("u-1")
    expect(u?.refreshTokenOrigen).toEqual({ tipo: "legado" })
  })

  it("rechaza si el usuario está dado de baja o la organización inactiva", async () => {
    const t = await saveRefreshToken("u-1", true)
    db.users[0].deleted_at = new Date().toISOString()
    expect(await validateRefreshToken(t)).toBeNull()
    db.users[0].deleted_at = null
    db.users[0].organizations = { ...ORG, activo: false }
    expect(await validateRefreshToken(t)).toBeNull()
  })
})

describe("revocación y rotación", () => {
  it("revocar una sesión no toca las otras del mismo usuario", async () => {
    const pc = await saveRefreshToken("u-1", true)
    const cel = await saveRefreshToken("u-1", true)
    await revocarRefreshToken(pc)
    expect(await validateRefreshToken(pc)).toBeNull()
    expect(await validateRefreshToken(cel)).not.toBeNull()
  })

  it("invalidar al usuario corta todas sus sesiones y el token legado", async () => {
    const pc = await saveRefreshToken("u-1", true)
    db.users[0].refresh_token = "e".repeat(128)
    db.users[0].refresh_token_expires = enDias(3)
    await invalidateRefreshToken("u-1")
    expect(await validateRefreshToken(pc)).toBeNull()
    expect(await validateRefreshToken("e".repeat(128))).toBeNull()
  })

  it("rotar deja inservible el token usado", async () => {
    const viejo = await saveRefreshToken("u-1", true)
    const nuevo = await rotarRefreshToken(viejo, "u-1")
    expect(nuevo).not.toBe(viejo)
    expect(await validateRefreshToken(viejo)).toBeNull()
    expect(await validateRefreshToken(nuevo)).not.toBeNull()
  })

  it("rotar un token legado lo borra de users", async () => {
    const legado = "d".repeat(128)
    db.users[0].refresh_token = legado
    db.users[0].refresh_token_expires = enDias(3)
    await rotarRefreshToken(legado, "u-1")
    expect(db.users[0].refresh_token).toBeNull()
  })
})

describe("revalidarTokenSesion", () => {
  const AHORA = 1_800_000_000

  it("no consulta la base antes de tiempo", async () => {
    const token = { id: "u-1", refreshToken: "x".repeat(128), revalidarEn: AHORA + 10, role: "TECNICO" }
    expect(await revalidarTokenSesion(token, AHORA)).toBe(token)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("un token sin revalidarEn (emitido antes del cambio) se revalida ya", async () => {
    const t = await saveRefreshToken("u-1", true)
    vi.mocked(supabaseAdmin.from).mockClear()
    const token: Record<string, unknown> = { id: "u-1", refreshToken: t, role: "TECNICO" }
    const out = await revalidarTokenSesion(token, AHORA)
    expect(supabaseAdmin.from).toHaveBeenCalled()
    expect(out.revalidarEn).toBe(AHORA + REVALIDAR_CADA_SEG)
    expect(out.error).toBeUndefined()
  })

  it("resincroniza rol, sucursal y nombre desde la base", async () => {
    const t = await saveRefreshToken("u-1", true)
    db.users[0].rol = "ADMIN"
    db.users[0].sucursal_id = null
    db.users[0].nombre = "Nuevo nombre"
    const out = await revalidarTokenSesion(
      { id: "u-1", refreshToken: t, role: "TECNICO", sucursalId: "suc-1", revalidarEn: AHORA - 1 },
      AHORA
    )
    expect(out).toMatchObject({ role: "ADMIN", sucursalId: null, name: "Nuevo nombre" })
  })

  it("una sesión revocada queda marcada como vencida", async () => {
    const t = await saveRefreshToken("u-1", true)
    await invalidateRefreshToken("u-1")
    const token: Record<string, unknown> = { id: "u-1", refreshToken: t, revalidarEn: AHORA - 1 }
    const out = await revalidarTokenSesion(token, AHORA)
    expect(out.error).toBe("RefreshTokenExpired")
  })

  it("no toca tokens de impersonación ni tokens ya vencidos", async () => {
    const imp = { id: "u-1", isImpersonating: true, revalidarEn: 0 }
    const vencido = { id: "u-1", refreshToken: "x".repeat(128), error: "RefreshTokenExpired" }
    expect(await revalidarTokenSesion(imp, AHORA)).toBe(imp)
    expect(await revalidarTokenSesion(vencido, AHORA)).toBe(vencido)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
