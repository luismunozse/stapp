import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  mockSupabaseFrom,
  createChainMock,
  parseResponse,
} from "./helpers"

// practica is mocked globally in vitest.setup.ts (deletePracticeData stubbed,
// countRealOrders real, so the count goes through the mocked supabase client).
// mismoRubro stays real: the route's no-op decision is part of what is tested.
vi.mock("@/lib/rubros/cambio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rubros/cambio")>()),
  aplicarCambioDeRubro: vi.fn(),
  contarTiposActivos: vi.fn(),
}))

import { deletePracticeData } from "@/lib/onboarding/practica"
import { aplicarCambioDeRubro, contarTiposActivos } from "@/lib/rubros/cambio"
import { PUT } from "@/app/api/onboarding/rubro/route"

const enviar = (cuerpo: string) =>
  PUT(
    new Request("http://localhost:3000/api/onboarding/rubro", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: cuerpo,
    })
  )

const put = (body: unknown) => enviar(JSON.stringify(body))

const ERROR_INTERNO = "No pudimos cambiar el rubro. Probá de nuevo."

function mockOrg(
  org: { rubro: string | null; rubro_detalle: string | null } = {
    rubro: "electrodomesticos",
    rubro_detalle: null,
  },
  ordenesReales = 0
) {
  const organizations = createChainMock(org)
  const ordenes = createChainMock(null, null, ordenesReales)
  mockSupabaseFrom({ organizations, ordenes_servicio: ordenes })
  return { organizations, ordenes }
}

vi.spyOn(console, "error").mockImplementation(() => {})

describe("PUT /api/onboarding/rubro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockOrg()
    vi.mocked(deletePracticeData).mockResolvedValue({ ordenBorrada: true, clienteConservado: false })
    vi.mocked(aplicarCambioDeRubro).mockResolvedValue({ tiposActivos: 7 })
    vi.mocked(contarTiposActivos).mockResolvedValue(4)
  })

  it("rejects a request without a session", async () => {
    mockAuthError()

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(401)
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it.each(["TECNICO", "VENDEDOR"])("rejects a %s: only an admin changes the rubro", async (role) => {
    mockAuthSuccess({ role })

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(403)
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("rejects a body that is not JSON", async () => {
    const { status, body } = await parseResponse(await enviar("{no es json"))

    expect(status).toBe(400)
    expect(body.error).toBe("Datos inválidos")
  })

  it.each<{ caso: string; body: unknown; mensaje: string }>([
    { caso: "unknown rubro id", body: { rubro: "plomeria" }, mensaje: "Elegí qué reparás" },
    { caso: "rubro is not a string", body: { rubro: 3 }, mensaje: "Elegí qué reparás" },
    { caso: "missing rubro", body: {}, mensaje: "Elegí qué reparás" },
    { caso: "body is an array", body: [], mensaje: "Datos inválidos" },
    {
      caso: "genérico without trade",
      body: { rubro: "generico" },
      mensaje: "Contanos qué reparás para preparar tu cuenta",
    },
    {
      caso: "genérico with a blank trade",
      body: { rubro: "generico", rubroDetalle: "   " },
      mensaje: "Contanos qué reparás para preparar tu cuenta",
    },
    {
      caso: "genérico with an unusable trade",
      body: { rubro: "generico", rubroDetalle: "###" },
      mensaje: "Escribí qué reparás con palabras, por ejemplo: máquinas de café",
    },
    {
      caso: "trade longer than the signup limit",
      body: { rubro: "generico", rubroDetalle: "x".repeat(121) },
      mensaje: "Contanos qué reparás en menos de 120 caracteres",
    },
  ])("answers 400 and changes nothing: $caso", async ({ body: payload, mensaje }) => {
    const { status, body } = await parseResponse(await put(payload))

    expect(status).toBe(400)
    expect(body.error).toBe(mensaje)
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("deletes the practice, then applies the change, and answers with the new rubro", async () => {
    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(200)
    expect(body).toEqual({ rubro: "electronica", rubroDetalle: null, tiposActivos: 7 })
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
    expect(aplicarCambioDeRubro).toHaveBeenCalledWith(
      "org-1",
      { rubro: "electrodomesticos", rubroDetalle: null },
      { rubro: "electronica", rubroDetalle: null }
    )
    const borrado = vi.mocked(deletePracticeData).mock.invocationCallOrder[0]
    const cambio = vi.mocked(aplicarCambioDeRubro).mock.invocationCallOrder[0]
    expect(borrado).toBeLessThan(cambio)
  })

  it("passes the genérico trade trimmed and returns it", async () => {
    const { body } = await parseResponse(
      await put({ rubro: "generico", rubroDetalle: "  maquinas de cafe  " })
    )

    expect(aplicarCambioDeRubro).toHaveBeenCalledWith("org-1", expect.anything(), {
      rubro: "generico",
      rubroDetalle: "maquinas de cafe",
    })
    expect(body.rubroDetalle).toBe("maquinas de cafe")
  })

  it("drops a stray trade text when the rubro is a curated pack", async () => {
    await put({ rubro: "automotor", rubroDetalle: "maquinas de cafe" })

    expect(aplicarCambioDeRubro).toHaveBeenCalledWith("org-1", expect.anything(), {
      rubro: "automotor",
      rubroDetalle: null,
    })
  })

  it("answers 500 and does not seed when the practice cannot be deleted", async () => {
    vi.mocked(deletePracticeData).mockRejectedValue(new Error("practice boom"))

    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_INTERNO)
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("answers 500 when the change itself fails", async () => {
    vi.mocked(aplicarCambioDeRubro).mockRejectedValue(new Error("tipos_dispositivo: boom"))

    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_INTERNO)
  })

  it("answers 500 and changes nothing when the org cannot be read", async () => {
    mockSupabaseFrom({
      organizations: createChainMock(null, { message: "org boom" }),
      ordenes_servicio: createChainMock(null, null, 0),
    })

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(deletePracticeData).not.toHaveBeenCalled()
  })

  it("answers 409 and touches nothing when the shop has a real order", async () => {
    mockOrg(undefined, 1)

    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(409)
    expect(body.error).toBe("Ya tenés órdenes cargadas: el rubro no se puede cambiar desde acá.")
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("counts only the org's real orders, not the practice", async () => {
    const { ordenes } = mockOrg()

    await put({ rubro: "electronica" })

    expect(ordenes.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", false)
  })

  it("fails closed when the real-order count errors", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ rubro: "electrodomesticos", rubro_detalle: null }),
      ordenes_servicio: createChainMock(null, { message: "count boom" }),
    })

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("answers 200 without touching anything when the rubro does not change", async () => {
    mockOrg({ rubro: "electrodomesticos", rubro_detalle: null })

    const { status, body } = await parseResponse(await put({ rubro: "electrodomesticos" }))

    expect(status).toBe(200)
    expect(body).toEqual({ rubro: "electrodomesticos", rubroDetalle: null, tiposActivos: 4 })
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
    expect(contarTiposActivos).toHaveBeenCalledWith("org-1")
  })

  it("treats the same genérico trade, modulo spaces, as no change", async () => {
    mockOrg({ rubro: "generico", rubro_detalle: "maquinas de cafe" })

    await put({ rubro: "generico", rubroDetalle: " maquinas de cafe " })

    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  // Guard: the 409 runs before the no-op check.
  it("still answers 409 for the same rubro when the shop has real orders", async () => {
    mockOrg({ rubro: "electrodomesticos", rubro_detalle: null }, 2)

    const { status } = await parseResponse(await put({ rubro: "electrodomesticos" }))

    expect(status).toBe(409)
    expect(contarTiposActivos).not.toHaveBeenCalled()
  })
})
