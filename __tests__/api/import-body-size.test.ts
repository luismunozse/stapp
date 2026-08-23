// @vitest-environment node
/**
 * /api/import recibe el archivo como una string base64 dentro del JSON, así que
 * `request.json()` materializa el archivo entero en memoria.
 *
 * Antes, una organización sin el feature de importación se comía un 403 antes de
 * que nadie tocara el cuerpo. Al mover el gate de entidad arriba del de plan —lo
 * correcto, porque el mensaje de plan era engañoso— el cuerpo pasó a leerse
 * primero, y con eso el agujero anotado en docs/audit-2026-06-09.md
 * ("Import execute accepts unbounded base64 file body") se abrió de las orgs Pro
 * a todas. El guard va sobre `content-length`, antes de leer nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { MAX_IMPORT_BODY_BYTES } from "@/lib/import-limits"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

/**
 * Request con un `content-length` declarado a mano. El cuerpo real es chico: lo
 * que se está probando es que el guard corta por lo DECLARADO, sin leerlo.
 */
function requestConTamano(declarado: number, cuerpo: string) {
  return new Request("http://localhost:3000/api/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(declarado),
    },
    body: cuerpo,
  })
}

const CUERPO_VALIDO = JSON.stringify({
  file: "eyJhIjoxfQ==",
  mime: "text/plain",
  filename: "datos.txt",
  entityType: "INVENTARIO",
})

describe("/api/import — techo de tamaño del cuerpo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      organizations: createChainMock({ vendedores_administran_inventario: true }),
    })
  })

  it("rechaza con 413 un cuerpo declarado por encima del techo", async () => {
    const { POST } = await import("@/app/api/import/execute/route")
    const { status, body } = await parseResponse(
      await POST(requestConTamano(MAX_IMPORT_BODY_BYTES + 1, CUERPO_VALIDO)),
    )

    expect(status).toBe(413)
    expect(body.error).toMatch(/demasiado grande/i)
  })

  /**
   * La prueba de que corta ANTES de leer: con un cuerpo que ni siquiera es JSON
   * válido, la respuesta sigue siendo el 413 del techo y no un error de parseo.
   * Si el guard corriera después de `request.json()`, acá se vería otra cosa.
   */
  it("corta antes de leer el cuerpo, no después", async () => {
    const { POST } = await import("@/app/api/import/execute/route")
    const { status } = await parseResponse(
      await POST(requestConTamano(MAX_IMPORT_BODY_BYTES + 1, "esto no es json")),
    )

    expect(status).toBe(413)
  })

  it("deja pasar un cuerpo dentro del techo", async () => {
    const { POST } = await import("@/app/api/import/execute/route")
    const { status } = await parseResponse(
      await POST(requestConTamano(MAX_IMPORT_BODY_BYTES - 1, CUERPO_VALIDO)),
    )

    // 400 de formato: el techo quedó atrás.
    expect(status).toBe(400)
  })

  it("aplica el mismo techo en el preview", async () => {
    const { POST } = await import("@/app/api/import/preview/route")
    const { status, body } = await parseResponse(
      await POST(requestConTamano(MAX_IMPORT_BODY_BYTES + 1, CUERPO_VALIDO)),
    )

    expect(status).toBe(413)
    expect(body.error).toMatch(/demasiado grande/i)
  })

  it("no le pide nada a un request sin content-length declarado", async () => {
    const { POST } = await import("@/app/api/import/execute/route")
    const req = new Request("http://localhost:3000/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: CUERPO_VALIDO,
    })
    // Undici puede o no completar content-length; el guard tiene que ser
    // indiferente a eso y dejar seguir.
    const { status } = await parseResponse(await POST(req))

    expect(status).toBe(400)
  })
})
