import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"
import {
  calcularFingerprint,
  esRefValido,
  generarRef,
  normalizarError,
  registrarError,
} from "@/lib/error-log"

describe("error-log: piezas puras", () => {
  it("genera códigos con el formato que se le muestra al taller", () => {
    for (let i = 0; i < 50; i++) expect(esRefValido(generarRef())).toBe(true)
    expect(esRefValido("E-000000")).toBe(false) // sin 0/O/1/I: se dictan por teléfono
    expect(esRefValido("<script>")).toBe(false)
  })

  it("normaliza Error, string y errores planos de Supabase", () => {
    expect(normalizarError(new Error("boom")).message).toBe("boom")
    expect(normalizarError("texto").message).toBe("texto")
    expect(normalizarError({ code: "57014", message: "statement timeout", details: null }).message).toBe(
      "57014 | statement timeout"
    )
    expect(normalizarError(undefined).message).toBe("undefined")
  })

  it("agrupa el mismo error aunque cambien ids y números", () => {
    const a = calcularFingerprint("API", "/api/ordenes/[id]", "orden 123 no existe (c6a451dace9113ee4ad5a1f13)")
    const b = calcularFingerprint("API", "/api/ordenes/[id]", "orden 456 no existe (c694f1ec5b39610bb2fe1f2a6)")
    const c = calcularFingerprint("API", "/api/ventas", "orden 123 no existe")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe("registrarError", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("ERROR_LOG_FORCE", "1")
    vi.stubEnv("SUPERADMIN_EMAIL", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("guarda la fila y devuelve el código", async () => {
    const tabla = createChainMock(null, null)
    mockSupabaseFrom({ error_logs: tabla })

    const ref = await registrarError({
      source: "API",
      error: new Error("se rompió"),
      route: "/api/ordenes",
      method: "POST",
      organizationId: "org-1",
    })

    expect(esRefValido(ref)).toBe(true)
    expect(tabla.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "API",
        ref,
        route: "/api/ordenes",
        method: "POST",
        organization_id: "org-1",
        message: "se rompió",
      })
    )
  })

  it("respeta el código que ya vio el usuario", async () => {
    mockSupabaseFrom({ error_logs: createChainMock(null, null) })
    expect(await registrarError({ source: "CLIENT", error: "x", ref: "E-ABCDEF" })).toBe("E-ABCDEF")
  })

  it("nunca lanza: si la base falla, igual devuelve un código", async () => {
    mockSupabaseFrom({ error_logs: createChainMock(null, { message: "relation error_logs does not exist" }) })
    await expect(registrarError({ source: "API", error: new Error("x") })).resolves.toMatch(/^E-/)
  })

  it("recorta mensajes enormes", async () => {
    const tabla = createChainMock(null, null)
    mockSupabaseFrom({ error_logs: tabla })
    await registrarError({ source: "API", error: new Error("a".repeat(10_000)) })
    const fila = tabla.insert.mock.calls[0][0]
    expect(fila.message.length).toBeLessThanOrEqual(2001)
  })
})
