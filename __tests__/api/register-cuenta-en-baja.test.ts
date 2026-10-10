// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/email", () => ({ sendVerificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/google", () => ({
  verifyGoogleIdToken: vi.fn().mockResolvedValue({ email: "  User@Example.com ", name: "Alice G" }),
}))

const validBody = {
  organizacion: { nombre: "Acme", slug: "acme" },
  usuario: { nombre: "Alice", email: "user@example.com", password: "supersecret" },
}

const googleBody = {
  organizacion: { nombre: "Acme", slug: "acme" },
  usuario: { nombre: "", email: "" },
  googleIdToken: "token",
}

async function call(existingUser: unknown, lookupError: unknown = null, body: unknown = validBody) {
  const { supabaseAdmin } = await import("@/lib/supabase")
  const usersChain = createChainMock(existingUser, lookupError)
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
    table === "users" ? usersChain : createChainMock(null, null)) as never)
  const { POST } = await import("@/app/api/auth/register/route")
  const res = await parseResponse(await POST(createPostRequest(body) as never))
  return { ...res, usersChain, supabaseAdmin }
}

describe("register con un email que ya existe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("usuario dado de baja: mensaje de eliminación en curso", async () => {
    const { status, body } = await call({ id: "u1", deleted_at: "2026-10-05", organizations: { deletion_requested_at: null } })
    expect(status).toBe(400)
    expect(body.error).toBe("Esta cuenta está en proceso de eliminación, escribí a soporte")
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
  })

  it("usuario de un taller que pidió eliminarse (los usuarios no llevan deleted_at): mismo mensaje", async () => {
    const { body } = await call({ id: "u1", deleted_at: null, organizations: { deletion_requested_at: "2026-10-05" } })
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
  })

  it("la relación puede venir como arreglo", async () => {
    const { body } = await call({ id: "u1", deleted_at: null, organizations: [{ deletion_requested_at: "2026-10-05" }] })
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
  })

  it("usuario normal: sigue diciendo que ya existe", async () => {
    const { status, body } = await call({ id: "u1", deleted_at: null, organizations: { deletion_requested_at: null } })
    expect(status).toBe(400)
    expect(body.error).toBe("Ya existe una cuenta con este email")
    expect(body.code).toBeUndefined()
  })

  it("registro con Google: mismo chequeo, con el email normalizado, y no inserta nada", async () => {
    const { body, usersChain, supabaseAdmin } = await call(
      { id: "u1", deleted_at: "2026-10-05", organizations: null },
      null,
      googleBody,
    )
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
    expect(usersChain.eq).toHaveBeenCalledWith("email", "user@example.com")
    expect(usersChain.insert).not.toHaveBeenCalled()
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(1)
  })

  it("error real de la consulta: falla cerrado, sin crear nada", async () => {
    const { status, body, usersChain, supabaseAdmin } = await call(null, { code: "XX000", message: "db down" })
    expect(status).toBe(500)
    expect(body.error).toBe("Error interno del servidor")
    expect(usersChain.insert).not.toHaveBeenCalled()
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(1)
  })
})
