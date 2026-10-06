// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/totp", () => ({ verifyUserTotpCode: vi.fn() }))
import { verifyUserTotpCode } from "@/lib/totp"
import { verifyReauth } from "@/lib/account-deletion/reauth"

const HASH = bcrypt.hashSync("secreto123", 4)
const user = (over: Record<string, unknown> = {}) =>
  createChainMock(
    { email: "Juan@Gmail.com", password: HASH, provider: "credentials", totp_enabled: false, ...over },
    null,
  )
const googleUser = (over: Record<string, unknown> = {}) => user({ password: null, provider: "google", ...over })

describe("verifyReauth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as never)
  })

  it("acepta la contraseña correcta", async () => {
    mockSupabaseFrom({ users: user() })
    expect(await verifyReauth("u1", { password: "secreto123" })).toEqual({ ok: true })
  })

  it("rechaza contraseña incorrecta o vacía y suma un intento fallido (lockout)", async () => {
    mockSupabaseFrom({ users: user() })
    expect(await verifyReauth("u1", { password: "mala" })).toMatchObject({ ok: false, status: 401, code: "WRONG_CREDENTIAL" })
    expect(await verifyReauth("u1", { password: "" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("handle_failed_login", { p_email: "Juan@Gmail.com" })
  })

  it("usuario con password no puede pasar tipeando su email", async () => {
    mockSupabaseFrom({ users: user() })
    expect(await verifyReauth("u1", { email: "juan@gmail.com" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
  })

  it("usuario Google (sin password): alcanza con tipear su email, sin distinguir mayúsculas", async () => {
    mockSupabaseFrom({ users: googleUser() })
    expect(await verifyReauth("u1", { email: " juan@gmail.com " })).toEqual({ ok: true })
    expect(await verifyReauth("u1", { email: "otro@gmail.com" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
    expect(await verifyReauth("u1", {})).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
  })

  it("falla cerrado: sin password y sin provider google nunca pasa", async () => {
    mockSupabaseFrom({ users: user({ password: null, provider: "credentials" }) })
    expect(await verifyReauth("u1", { email: "juan@gmail.com" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
    mockSupabaseFrom({ users: user({ password: null, provider: null }) })
    expect(await verifyReauth("u1", { email: "juan@gmail.com" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
  })

  it("con 2FA activo exige el código", async () => {
    mockSupabaseFrom({ users: user({ totp_enabled: true }) })
    expect(await verifyReauth("u1", { password: "secreto123" })).toMatchObject({ ok: false, code: "REQUIRES_2FA" })
  })

  it("con 2FA activo valida el código", async () => {
    mockSupabaseFrom({ users: user({ totp_enabled: true }) })
    vi.mocked(verifyUserTotpCode).mockResolvedValueOnce({ valid: false })
    expect(await verifyReauth("u1", { password: "secreto123", totpCode: "000000" })).toMatchObject({ ok: false, code: "INVALID_2FA" })
    vi.mocked(verifyUserTotpCode).mockResolvedValueOnce({ valid: true })
    expect(await verifyReauth("u1", { password: "secreto123", totpCode: "123456" })).toEqual({ ok: true })
    expect(verifyUserTotpCode).toHaveBeenLastCalledWith("u1", "123456")
  })

  it("usuario Google con 2FA: email + código", async () => {
    mockSupabaseFrom({ users: googleUser({ totp_enabled: true }) })
    vi.mocked(verifyUserTotpCode).mockResolvedValueOnce({ valid: true })
    expect(await verifyReauth("u1", { email: "juan@gmail.com", totpCode: "123456" })).toEqual({ ok: true })
  })

  it("no valida el TOTP si la contraseña ya falló (no gasta códigos de respaldo)", async () => {
    mockSupabaseFrom({ users: user({ totp_enabled: true }) })
    await verifyReauth("u1", { password: "mala", totpCode: "123456" })
    expect(verifyUserTotpCode).not.toHaveBeenCalled()
  })

  it("usuario inexistente: falla genérico", async () => {
    mockSupabaseFrom({ users: createChainMock(null, { message: "no rows" }) })
    expect(await verifyReauth("u1", { password: "x" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
  })
})
