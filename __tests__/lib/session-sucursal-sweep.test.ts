import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// requireAuth() hands API routes the user's CURRENT branch, but anything that
// takes the session straight from auth(), getAuthSession() or useSession() reads
// `sucursalId` from the JWT, which is stale for up to ~18 h after an ADMIN moves
// the user. Server pages go through sesionConSucursalVigente() and API routes
// through requireAuth() (or a wrapper); everything else has to be listed here
// with the reason it can live with the JWT value.
const ROOT = process.cwd()

// Directories (relative to ROOT) and single files that are scanned.
const RAICES = ["app", "lib", "components", "hooks", "contexts"]
const ARCHIVOS_SUELTOS = ["middleware.ts"]

// Files that may read the JWT branch.
const EXENTOS = new Map<string, string>([
  ["lib/auth.ts", "defines the JWT and session callbacks that PRODUCE session.user.sucursalId"],
  ["lib/auth-utils.ts", "getAuthSession()/requireAuth() are the refresh itself"],
  ["lib/sesion-sucursal.ts", "reads session.user only to replace the branch with the DB value"],
  [
    "components/pwa/api-cache-session-guard.tsx",
    "client component; the branch is one part of the identity key that flushes the SW API cache. " +
      "Defense in depth, not authorization: identity-dependent API routes are not SW-cached",
  ],
])

// Where a session comes from without going through the DB refresh: auth() (with
// or without await, also as `mod.auth()`), getAuthSession() and useSession().
const FUENTE_CRUDA = /\bauth\(\s*\)|\bgetAuthSession\(|\buseSession\(/
// `import { auth as obtenerSesion }`: the alias is a raw source too once it is called.
const ALIAS_DE_FUENTE = /\b(?:auth|getAuthSession|useSession)\s+as\s+([A-Za-z_$][\w$]*)/g
// `.sucursalId` property reads, and `const { sucursalId } = session.user` style destructuring.
const LEE_SUCURSAL = /\.sucursalId\b|\{[^{}]*\bsucursalId\b[^{}]*\}\s*=\s*[\w$!?.]*\buser\b/

function tomaSesionCruda(src: string): boolean {
  if (FUENTE_CRUDA.test(src)) return true
  return [...src.matchAll(ALIAS_DE_FUENTE)].some(([, alias]) => new RegExp(`\\b${alias}\\(`).test(src))
}

/** Code without comments, so prose like "the middleware/auth() accept it" is not a call. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

/** True when a file takes a raw session and reads the branch from it. */
function leeSucursalDelJwt(fuente: string): boolean {
  const src = sinComentarios(fuente)
  return tomaSesionCruda(src) && LEE_SUCURSAL.test(src) && !src.includes("sesionConSucursalVigente(")
}

function recorrer(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) recorrer(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe("detector", () => {
  it.each([
    ["auth() with a property read", `const session = await auth()\nconst s = session.user.sucursalId`],
    ["getAuthSession() with a property read", `const { session } = await getAuthSession()\nuse(session!.user.sucursalId)`],
    ["useSession() with a property read", `const { data } = useSession()\nconst s = data?.user?.sucursalId`],
    ["destructuring from session.user", `const session = await auth()\nconst { role, sucursalId } = session.user`],
    ["destructuring from session!.user", `const { session } = await getAuthSession()\nconst { sucursalId } = session!.user`],
    ["destructuring from a user variable", `const { data } = useSession()\nconst user = data?.user\nconst { sucursalId } = user`],
    ["auth() without await", `const pendiente = auth()\npendiente.then((s) => s?.user.sucursalId)`],
    ["auth().then(...) chained", `auth().then((s) => use(s?.user.sucursalId))`],
    ["an aliased import of auth", `import { auth as obtenerSesion } from "@/lib/auth"\nconst s = await obtenerSesion()\nuse(s?.user.sucursalId)`],
    ["an aliased import of getAuthSession", `import { getAuthSession as leer } from "@/lib/auth-utils"\nconst { session } = await leer()\nuse(session!.user.sucursalId)`],
    ["an aliased import of useSession", `import { useSession as usarSesion } from "next-auth/react"\nconst { data } = usarSesion()\nuse(data?.user?.sucursalId)`],
    ["a namespace import of the auth module", `import * as authMod from "@/lib/auth"\nconst s = await authMod.auth()\nuse(s?.user.sucursalId)`],
  ])("flags %s", (_caso, src) => {
    expect(leeSucursalDelJwt(src)).toBe(true)
  })

  it.each([
    ["the fresh helper", `const session = await sesionConSucursalVigente()\nconst s = session.user.sucursalId`],
    ["requireAuth() only", `const { session } = await requireAuth()\nconst s = session!.user.sucursalId`],
    ["a raw session that never reads the branch", `const session = await auth()\nconst o = session.user.organizationId`],
    ["a branch read with no session source", `const d = resolver()\nreturn d.sucursalId`],
    ["a destructuring of something that is not a user", `const session = await auth()\nconst { sucursalId } = lectura`],
    ["an aliased import that is never called", `import { auth as obtenerSesion } from "@/lib/auth"\nconst d = resolver()\nreturn d.sucursalId`],
    ["the NextAuth(...) setup", `export const { auth } = NextAuth(config)\nconst d = resolver()\nreturn d.sucursalId`],
    ["auth() mentioned only in comments", `// the middleware/auth() accept it\n/* uses useSession() */\nconst d = resolver()\nreturn d.sucursalId`],
  ])("ignores %s", (_caso, src) => {
    expect(leeSucursalDelJwt(src)).toBe(false)
  })
})

describe("source tree", () => {
  const archivos = [
    ...RAICES.flatMap((d) => recorrer(join(ROOT, d))),
    ...ARCHIVOS_SUELTOS.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
  ].map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), src: readFileSync(f, "utf8") }))

  it("scans the real tree (guards against a ghost loop)", () => {
    const rels = new Set(archivos.map((a) => a.rel))
    expect(archivos.length).toBeGreaterThan(500)
    for (const esperado of [
      "app/(dashboard)/layout.tsx",
      "app/api/operadores/route.ts",
      "lib/auth-utils.ts",
      "components/pwa/api-cache-session-guard.tsx",
      "middleware.ts",
    ]) {
      expect(rels.has(esperado), esperado).toBe(true)
    }
  })

  it("the scan reaches client code: the PWA guard is flagged without its exemption", () => {
    const guard = archivos.find((a) => a.rel === "components/pwa/api-cache-session-guard.tsx")
    expect(leeSucursalDelJwt(guard!.src)).toBe(true)
  })

  it("every exemption points at a file that exists", () => {
    const rels = new Set(archivos.map((a) => a.rel))
    expect([...EXENTOS.keys()].filter((k) => !rels.has(k))).toEqual([])
  })

  it("nothing reads the JWT branch from a raw session outside the exemptions", () => {
    const ofensores = archivos
      .filter(({ rel, src }) => leeSucursalDelJwt(src) && !EXENTOS.has(rel))
      .map(({ rel }) => rel)
      .sort()
    expect(ofensores).toEqual([])
  })
})
