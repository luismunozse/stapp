// @vitest-environment node
// El registro tampoco puede crear una cuenta con un email de SUPERADMIN_EMAILS
// (ver superadmin-email-reservado.test.ts). Misma respuesta que un duplicado.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/email", () => ({ sendVerificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/google", () => ({
  verifyGoogleIdToken: vi.fn().mockResolvedValue({ email: "Root@Stapp.com.ar", name: "X" }),
}))

async function registrar(body: unknown) {
  const { supabaseAdmin } = await import("@/lib/supabase")
  const usersChain = createChainMock(null, { code: "PGRST116", message: "0 rows" })
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
    table === "users" ? usersChain : createChainMock(null, null)) as never)
  const { POST } = await import("@/app/api/auth/register/route")
  const res = await parseResponse(await POST(createPostRequest(body) as never))
  return { ...res, usersChain }
}

describe("register con un email de superadmin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv("SUPERADMIN_EMAILS", "root@stapp.com.ar")
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ["con password", {
      organizacion: { nombre: "Acme", slug: "acme" },
      usuario: { nombre: "Ana", email: "ROOT@stapp.com.ar", password: "supersecret" },
    }],
    ["con Google", {
      organizacion: { nombre: "Acme", slug: "acme" },
      usuario: { nombre: "", email: "" },
      googleIdToken: "token",
    }],
  ])("%s: 400 como un duplicado y sin crear nada", async (_caso, body) => {
    const { status, body: res, usersChain } = await registrar(body)
    expect(status).toBe(400)
    expect(res.error).toBe("Ya existe una cuenta con este email")
    expect(usersChain.insert).not.toHaveBeenCalled()
  })
})
