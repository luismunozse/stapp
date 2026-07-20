/**
 * Tests: POST /api/asistente
 *
 * Cubre el contrato de la spec: 401 sin sesión, 403 si el plan no incluye el
 * asistente, 429 por rate limit de usuario y por tope diario de org, 400 por
 * validación, happy path (Claude + inserts de USER y ASSISTANT con uso de
 * tokens) y fallo upstream de Claude (502, sin quemar el tope diario).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

const { canUseAsistenteMock, checkAsistenteRateLimitMock, createMessageMock } = vi.hoisted(() => ({
  canUseAsistenteMock: vi.fn(),
  checkAsistenteRateLimitMock: vi.fn(),
  createMessageMock: vi.fn(),
}))

vi.mock("@/lib/asistente/access", () => ({
  canUseAsistente: canUseAsistenteMock,
}))

vi.mock("@/lib/asistente/rate-limit", () => ({
  checkAsistenteRateLimit: checkAsistenteRateLimitMock,
}))

vi.mock("@/lib/asistente/system-prompt", () => ({
  buildAsistenteSystemPrompt: () => "PROMPT DE PRUEBA (estático)",
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMessageMock }
  },
}))

import { POST } from "@/app/api/asistente/route"

// ---------------------------------------------------------------------------
// Helpers locales
// ---------------------------------------------------------------------------

/**
 * Chain "inteligente" para tablas donde el mismo nombre de tabla se usa con
 * distintos métodos de entrada (select de conteo, select de historial,
 * insert). A diferencia de createChainMock (una sola resolución fija por
 * tabla), acá el resolver decide en base a la primera llamada de la cadena.
 */
function createSmartChain(resolve: (calls: { method: string; args: any[] }[]) => any) {
  const calls: { method: string; args: any[] }[] = []
  const chain: any = {}
  const methods = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "limit", "range", "in", "is",
  ]
  for (const method of methods) {
    chain[method] = vi.fn((...args: any[]) => {
      calls.push({ method, args })
      return chain
    })
  }
  chain.single = vi.fn(() => Promise.resolve(resolve(calls)))
  chain.then = (res: any, rej?: any) => Promise.resolve(resolve(calls)).then(res, rej)
  chain.catch = (rej: any) => Promise.resolve(resolve(calls)).catch(rej)
  return chain
}

type SetupOpts = {
  zonaHoraria?: string
  usedToday?: number
  historial?: Array<{ tipo: string; contenido: string }>
}

function setupSupabase(opts: SetupOpts = {}) {
  const inserts: Array<{ table: string; payload: any }> = []

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "organizations") {
      return createChainMock({ zona_horaria: opts.zonaHoraria ?? "America/Argentina/Buenos_Aires" }) as any
    }

    if (table === "asistente_mensajes") {
      return createSmartChain((calls) => {
        const first = calls[0]
        if (first?.method === "insert") {
          inserts.push({ table, payload: first.args[0] })
          return { data: null, error: null }
        }
        const isCount = (first?.args?.[1] as any)?.count === "exact"
        if (isCount) {
          return { data: null, error: null, count: opts.usedToday ?? 0 }
        }
        return { data: opts.historial ?? [], error: null }
      }) as any
    }

    if (table === "asistente_conversaciones") {
      return createSmartChain((calls) => {
        const first = calls[0]
        if (first?.method === "insert") {
          inserts.push({ table, payload: first.args[0] })
          return { data: { id: "conv-new" }, error: null }
        }
        return { data: null, error: null }
      }) as any
    }

    return createChainMock(null, { message: `sin mock para tabla: ${table}` }) as any
  })

  return { inserts }
}

function req(body: unknown) {
  return createPostRequest(body, "http://localhost/api/asistente")
}

function claudeSuccess(overrides: Partial<any> = {}) {
  return {
    content: [{ type: "text", text: "Para agregar un cliente andá a Clientes → Nuevo." }],
    usage: {
      input_tokens: 500,
      output_tokens: 80,
      cache_read_input_tokens: 420,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/asistente", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("401: sin sesión, requireAuth devuelve el error y no toca la base", async () => {
    mockAuthError()

    const response = await POST(req({ message: "hola" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(canUseAsistenteMock).not.toHaveBeenCalled()
  })

  it("403 ASISTENTE_NOT_AVAILABLE: sesión OK pero el plan no incluye el asistente", async () => {
    mockAuthSuccess()
    canUseAsistenteMock.mockResolvedValue(false)

    const response = await POST(req({ message: "hola" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.code).toBe("ASISTENTE_NOT_AVAILABLE")
    expect(checkAsistenteRateLimitMock).not.toHaveBeenCalled()
  })

  it("429 RATE_LIMIT: gate OK pero el usuario superó el límite por minuto", async () => {
    mockAuthSuccess()
    canUseAsistenteMock.mockResolvedValue(true)
    checkAsistenteRateLimitMock.mockReturnValue(false)

    const response = await POST(req({ message: "hola" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(429)
    expect(body.code).toBe("RATE_LIMIT")
  })

  it("400: mensaje vacío falla la validación de zod", async () => {
    mockAuthSuccess()
    canUseAsistenteMock.mockResolvedValue(true)
    checkAsistenteRateLimitMock.mockReturnValue(true)

    const response = await POST(req({ message: "" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("vacío")
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it("429 DAILY_LIMIT: tope diario de la org ya está en 50", async () => {
    mockAuthSuccess()
    canUseAsistenteMock.mockResolvedValue(true)
    checkAsistenteRateLimitMock.mockReturnValue(true)
    const { inserts } = setupSupabase({ usedToday: 50 })

    const response = await POST(req({ message: "¿Cómo cargo una orden?" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(429)
    expect(body.code).toBe("DAILY_LIMIT")
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it("happy path: responde 200 e inserta fila USER y fila ASSISTANT con uso de tokens", async () => {
    mockAuthSuccess({ organizationId: "org-1", userId: "user-1" })
    canUseAsistenteMock.mockResolvedValue(true)
    checkAsistenteRateLimitMock.mockReturnValue(true)
    const { inserts } = setupSupabase({ usedToday: 3, historial: [] })
    createMessageMock.mockResolvedValueOnce(claudeSuccess())

    const response = await POST(req({ message: "¿Cómo agrego un cliente?", conversacionId: null }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.message).toBe("Para agregar un cliente andá a Clientes → Nuevo.")
    expect(body.conversacionId).toBe("conv-new")

    const mensajeInserts = inserts.filter((i) => i.table === "asistente_mensajes")
    expect(mensajeInserts).toHaveLength(2)

    const userRow = mensajeInserts[0].payload
    expect(userRow.tipo).toBe("USER")
    expect(userRow.contenido).toBe("¿Cómo agrego un cliente?")
    expect(userRow.organization_id).toBe("org-1")
    expect(userRow.conversacion_id).toBe("conv-new")

    const assistantRow = mensajeInserts[1].payload
    expect(assistantRow.tipo).toBe("ASSISTANT")
    expect(assistantRow.contenido).toBe("Para agregar un cliente andá a Clientes → Nuevo.")
    expect(assistantRow.modelo).toBe("claude-haiku-4-5")
    expect(assistantRow.input_tokens).toBe(500)
    expect(assistantRow.output_tokens).toBe(80)
    expect(assistantRow.cache_read_input_tokens).toBe(420)
    expect(assistantRow.cache_creation_input_tokens).toBe(0)
    expect(typeof assistantRow.tiempo_respuesta_ms).toBe("number")
  })

  it("502 UPSTREAM_ERROR: Claude falla y no se quema el tope diario", async () => {
    mockAuthSuccess()
    canUseAsistenteMock.mockResolvedValue(true)
    checkAsistenteRateLimitMock.mockReturnValue(true)
    const { inserts } = setupSupabase({ usedToday: 3, historial: [] })
    createMessageMock.mockRejectedValueOnce(new Error("Claude no responde"))

    const response = await POST(req({ message: "¿Cómo agrego un cliente?" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(502)
    expect(body.code).toBe("UPSTREAM_ERROR")
    expect(inserts.filter((i) => i.table === "asistente_mensajes")).toHaveLength(0)
  })
})
