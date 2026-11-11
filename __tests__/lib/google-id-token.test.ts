// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { verifyGoogleIdToken } from "@/lib/google"
import { cambiosAlVerificarConGoogle } from "@/lib/google-account"

const CLIENT_ID = "client-123.apps.googleusercontent.com"

function tokeninfo(payload: Record<string, unknown>, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: async () => payload })
  )
}

const VALIDO = {
  aud: CLIENT_ID,
  iss: "https://accounts.google.com",
  email: "ana@ejemplo.com",
  email_verified: "true",
  name: "Ana",
}

describe("verifyGoogleIdToken", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", CLIENT_ID)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("acepta un token válido con email verificado", async () => {
    tokeninfo(VALIDO)
    await expect(verifyGoogleIdToken("t")).resolves.toMatchObject({ email: "ana@ejemplo.com", emailVerified: true })
  })

  it("acepta email_verified como booleano", async () => {
    tokeninfo({ ...VALIDO, email_verified: true })
    await expect(verifyGoogleIdToken("t")).resolves.toMatchObject({ emailVerified: true })
  })

  it.each([["false"], [false], [undefined]])("rechaza un email no verificado por Google (%s)", async (v) => {
    tokeninfo({ ...VALIDO, email_verified: v })
    await expect(verifyGoogleIdToken("t")).rejects.toThrow(/verificado/i)
  })

  it("rechaza un token emitido para otra aplicación", async () => {
    tokeninfo({ ...VALIDO, aud: "otra-app" })
    await expect(verifyGoogleIdToken("t")).rejects.toThrow(/no corresponde/i)
  })

  it("falla cerrado si el client id no está configurado (no salta el chequeo de audiencia)", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "")
    tokeninfo({ ...VALIDO, aud: "cualquiera" })
    await expect(verifyGoogleIdToken("t")).rejects.toThrow(/no está configurado/i)
  })

  it("rechaza un emisor que no es Google", async () => {
    tokeninfo({ ...VALIDO, iss: "https://evil.example" })
    await expect(verifyGoogleIdToken("t")).rejects.toThrow(/Emisor/i)
  })
})

describe("cambiosAlVerificarConGoogle", () => {
  it("una cuenta ya verificada no cambia", () => {
    expect(cambiosAlVerificarConGoogle({ email_verified: true, password: "hash" })).toBeNull()
  })

  /**
   * Si la cuenta nunca verificó su email, la contraseña la eligió quien la
   * registró, que no necesariamente es el dueño del email. Google prueba que
   * el dueño es quien entra ahora: esa contraseña y las sesiones previas no
   * deben seguir sirviendo.
   */
  it("una cuenta sin verificar queda verificada, sin contraseña previa ni sesiones", () => {
    expect(cambiosAlVerificarConGoogle({ email_verified: false, password: "hash" })).toEqual({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires: null,
      password: null,
      refresh_token: null,
      refresh_token_expires: null,
      provider: "google",
    })
  })
})
