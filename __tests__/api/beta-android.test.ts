// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { GET, POST } from "@/app/api/beta-android/route"
import { PLAY_TESTING_URL } from "@/lib/android-beta"

type Fila = { email: string; estado: string; agregado_at?: string | null }

/**
 * Tabla fake que simula lo que hace PostgREST con un upsert por user_id: lo que
 * llega en el payload pisa lo existente y lo que no llega queda como estaba.
 * Un mock que ignora el payload daria verde aunque la ruta mande cualquier cosa.
 */
function tablaBeta(existente: Fila | null, error: { message: string } | null = null) {
  const chain = createChainMock(existente, error)
  const upsert = vi.fn((payload: Record<string, unknown>, _opts?: Record<string, unknown>) => {
    const resultado = { ...(existente ?? { estado: "PENDIENTE" }), ...payload }
    const out: any = createChainMock(resultado, null)
    return out
  })
  chain.upsert = upsert
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: existente, error })
  return { chain, upsert }
}

describe("GET /api/beta-android", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesion: 401", async () => {
    mockAuthError()
    expect((await GET()).status).toBe(401)
  })

  it("sin inscripcion devuelve null", async () => {
    mockAuthSuccess({ userId: "u1" })
    const { chain } = tablaBeta(null)
    mockSupabaseFrom({ android_beta_testers: chain })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toEqual({ inscripcion: null })
    // Mira SOLO la fila del usuario de la sesion.
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("PENDIENTE no trae linkInvitacion", async () => {
    mockAuthSuccess({ userId: "u1" })
    mockSupabaseFrom({ android_beta_testers: tablaBeta({ email: "a@gmail.com", estado: "PENDIENTE" }).chain })
    const { body } = await parseResponse(await GET())
    expect(body).toEqual({ inscripcion: { email: "a@gmail.com", estado: "PENDIENTE" } })
    expect(body.inscripcion).not.toHaveProperty("linkInvitacion")
  })

  it("DESCARTADO no trae linkInvitacion", async () => {
    mockAuthSuccess({ userId: "u1" })
    mockSupabaseFrom({ android_beta_testers: tablaBeta({ email: "a@gmail.com", estado: "DESCARTADO" }).chain })
    const { body } = await parseResponse(await GET())
    expect(body.inscripcion).toEqual({ email: "a@gmail.com", estado: "DESCARTADO" })
  })

  it("AGREGADO trae linkInvitacion", async () => {
    mockAuthSuccess({ userId: "u1" })
    mockSupabaseFrom({ android_beta_testers: tablaBeta({ email: "a@gmail.com", estado: "AGREGADO" }).chain })
    const { body } = await parseResponse(await GET())
    expect(body.inscripcion).toEqual({ email: "a@gmail.com", estado: "AGREGADO", linkInvitacion: PLAY_TESTING_URL })
  })

  it("si falla la lectura responde 500 (no inventa 'sin inscripcion')", async () => {
    mockAuthSuccess({ userId: "u1" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockSupabaseFrom({ android_beta_testers: tablaBeta(null, { message: "boom" }).chain })
    expect((await GET()).status).toBe(500)
  })

  it.each(["ADMIN", "TECNICO", "VENDEDOR"])("lo puede leer un %s", async (role) => {
    mockAuthSuccess({ userId: "u1", role })
    mockSupabaseFrom({ android_beta_testers: tablaBeta(null).chain })
    expect((await GET()).status).toBe(200)
  })
})

describe("POST /api/beta-android", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesion: 401 y no escribe", async () => {
    mockAuthError()
    const { chain, upsert } = tablaBeta(null)
    mockSupabaseFrom({ android_beta_testers: chain })
    expect((await POST(createPostRequest({ email: "a@gmail.com" }))).status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each(["", "no-es-un-mail", "a@", "@gmail.com", "   "])("email invalido %j: 400 y no escribe", async (email) => {
    mockAuthSuccess({ userId: "u1" })
    const { chain, upsert } = tablaBeta(null)
    mockSupabaseFrom({ android_beta_testers: chain })
    expect((await POST(createPostRequest({ email }))).status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("sin email en el body: 400", async () => {
    mockAuthSuccess({ userId: "u1" })
    mockSupabaseFrom({ android_beta_testers: tablaBeta(null).chain })
    expect((await POST(createPostRequest({}))).status).toBe(400)
  })

  it("crea la inscripcion: normaliza el email, usa user y org de la sesion, PENDIENTE", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1" })
    const { chain, upsert } = tablaBeta(null)
    mockSupabaseFrom({ android_beta_testers: chain })
    const { status, body } = await parseResponse(await POST(createPostRequest({ email: "  Juan.Perez@Empresa.COM " })))
    expect(status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [payload, opts] = upsert.mock.calls[0]
    expect(payload).toMatchObject({
      user_id: "u1",
      organization_id: "o1",
      email: "juan.perez@empresa.com",
      estado: "PENDIENTE",
    })
    expect(opts).toMatchObject({ onConflict: "user_id" })
    expect(body).toEqual({ inscripcion: { email: "juan.perez@empresa.com", estado: "PENDIENTE" } })
  })

  it("acepta un correo que no es gmail (las cuentas de Google pueden ser de cualquier dominio)", async () => {
    mockAuthSuccess({ userId: "u1" })
    mockSupabaseFrom({ android_beta_testers: tablaBeta(null).chain })
    expect((await POST(createPostRequest({ email: "dueno@mitaller.com.ar" }))).status).toBe(200)
  })

  it("volver a mandar con otro email lo actualiza y sigue PENDIENTE", async () => {
    mockAuthSuccess({ userId: "u1" })
    const { chain, upsert } = tablaBeta({ email: "viejo@gmail.com", estado: "PENDIENTE" })
    mockSupabaseFrom({ android_beta_testers: chain })
    const { body } = await parseResponse(await POST(createPostRequest({ email: "nuevo@gmail.com" })))
    expect(upsert.mock.calls[0][0]).toMatchObject({ email: "nuevo@gmail.com", estado: "PENDIENTE" })
    expect(body.inscripcion).toEqual({ email: "nuevo@gmail.com", estado: "PENDIENTE" })
    // La lectura previa mira SOLO la fila del usuario de la sesion.
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("DESCARTADO que se vuelve a anotar vuelve a PENDIENTE", async () => {
    mockAuthSuccess({ userId: "u1" })
    const { chain, upsert } = tablaBeta({ email: "a@gmail.com", estado: "DESCARTADO" })
    mockSupabaseFrom({ android_beta_testers: chain })
    const { body } = await parseResponse(await POST(createPostRequest({ email: "a@gmail.com" })))
    expect(upsert.mock.calls[0][0]).toMatchObject({ estado: "PENDIENTE", agregado_at: null })
    expect(body.inscripcion.estado).toBe("PENDIENTE")
    // La lectura previa mira SOLO la fila del usuario de la sesion.
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("AGREGADO con un email distinto vuelve a PENDIENTE (el nuevo no esta en la lista de Play)", async () => {
    mockAuthSuccess({ userId: "u1" })
    const { chain, upsert } = tablaBeta({ email: "a@gmail.com", estado: "AGREGADO", agregado_at: "2026-10-01T00:00:00Z" })
    mockSupabaseFrom({ android_beta_testers: chain })
    const { body } = await parseResponse(await POST(createPostRequest({ email: "otro@gmail.com" })))
    expect(upsert.mock.calls[0][0]).toMatchObject({ email: "otro@gmail.com", estado: "PENDIENTE", agregado_at: null })
    expect(body.inscripcion).toEqual({ email: "otro@gmail.com", estado: "PENDIENTE" })
    expect(body.inscripcion).not.toHaveProperty("linkInvitacion")
    // La lectura previa mira SOLO la fila del usuario de la sesion.
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("AGREGADO con el mismo email (aunque cambien mayusculas) NO retrocede", async () => {
    mockAuthSuccess({ userId: "u1" })
    const { chain, upsert } = tablaBeta({ email: "a@gmail.com", estado: "AGREGADO", agregado_at: "2026-10-01T00:00:00Z" })
    mockSupabaseFrom({ android_beta_testers: chain })
    const { body } = await parseResponse(await POST(createPostRequest({ email: "A@Gmail.com" })))
    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty("estado")
    expect(payload).not.toHaveProperty("agregado_at")
    expect(body.inscripcion).toEqual({ email: "a@gmail.com", estado: "AGREGADO", linkInvitacion: PLAY_TESTING_URL })
    // La lectura previa mira SOLO la fila del usuario de la sesion.
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("un body hostil no puede pisar user_id, organization_id ni estado", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1" })
    const { chain, upsert } = tablaBeta(null)
    mockSupabaseFrom({ android_beta_testers: chain })
    const res = await POST(
      createPostRequest({ email: "a@gmail.com", user_id: "victim", organization_id: "otra-org", estado: "AGREGADO" })
    )
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][0]).toMatchObject({ user_id: "u1", organization_id: "o1", estado: "PENDIENTE" })
    expect(upsert.mock.calls[0][0]).not.toHaveProperty("victim")
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1")
    expect(chain.eq).not.toHaveBeenCalledWith("user_id", "victim")
  })

  it("si falla la lectura previa responde 500 y no escribe", async () => {
    mockAuthSuccess({ userId: "u1" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { chain, upsert } = tablaBeta(null, { message: "boom" })
    mockSupabaseFrom({ android_beta_testers: chain })
    expect((await POST(createPostRequest({ email: "a@gmail.com" }))).status).toBe(500)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("si falla el upsert responde 500", async () => {
    mockAuthSuccess({ userId: "u1" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { chain } = tablaBeta(null)
    chain.upsert = vi.fn(() => createChainMock(null, { message: "boom" })) as any
    mockSupabaseFrom({ android_beta_testers: chain })
    expect((await POST(createPostRequest({ email: "a@gmail.com" }))).status).toBe(500)
  })

  it.each(["ADMIN", "TECNICO", "VENDEDOR"])("lo puede usar un %s", async (role) => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role })
    const { chain, upsert } = tablaBeta(null)
    mockSupabaseFrom({ android_beta_testers: chain })
    expect((await POST(createPostRequest({ email: "a@gmail.com" }))).status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})
