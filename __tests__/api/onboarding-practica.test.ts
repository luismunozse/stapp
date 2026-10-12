import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { deletePracticeData } from "@/lib/onboarding/practica"
import { GET, POST, DELETE } from "@/app/api/onboarding/practica/route"

const org = {
  nombre: "Taller",
  nombre_mostrar: "Taller Luis",
  slug: "taller",
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
}

const filaPractica = {
  id: "ord-p",
  estado: "RECIBIDO",
  public_token: "a".repeat(32),
  tipo_dispositivo: "CELULAR",
  dispositivo: "Moto G",
  problema_reportado: "No enciende",
  costo_final: null,
  fecha_completado: null,
  sucursal_id: "suc-1",
  cliente_id: "cli-p",
  clientes: { id: "cli-p", nombre: "Luis", email: "luis@taller.com" },
}

const cuerpo = { tipoDispositivo: "CELULAR", dispositivo: "Moto G", problemaReportado: "No enciende" }

function prepararAlta(
  opts: { tipo?: unknown; clienteError?: unknown; ordenError?: unknown; ordenesReales?: number; ganadora?: unknown; clienteSinTelefono?: unknown } = {}
) {
  // Base chain: countRealOrders (count) and getPracticaOrden (maybeSingle).
  const ordenes = createChainMock(opts.ganadora ?? null, null, opts.ordenesReales ?? 0)
  const ordenInsertChain = createChainMock(opts.ordenError ? null : filaPractica, opts.ordenError ?? null)
  const ordenInsert = vi.fn().mockReturnValue(ordenInsertChain)
  ordenes.insert = ordenInsert

  const clientes = createChainMock(opts.clienteSinTelefono ?? null)
  const clienteInsertChain = createChainMock(
    opts.clienteError ? null : { id: "cli-p" },
    opts.clienteError ?? null
  )
  const clienteInsert = vi.fn().mockReturnValue(clienteInsertChain)
  clientes.insert = clienteInsert
  const clienteDelete = vi.fn().mockReturnValue(clientes)
  clientes.delete = clienteDelete

  const eventos = createChainMock(null)
  const eventoInsert = vi.fn().mockReturnValue(eventos)
  eventos.insert = eventoInsert

  const tipos = createChainMock(opts.tipo === undefined ? { codigo: "CELULAR" } : opts.tipo)

  mockSupabaseFrom({
    tipos_dispositivo: tipos,
    users: createChainMock({ nombre: "Luis", email: "luis@taller.com" }),
    clientes,
    ordenes_servicio: ordenes,
    orden_eventos: eventos,
    organizations: createChainMock(org),
  })
  return { tipos, clientes, clienteInsert, clienteDelete, ordenes, ordenInsert, eventoInsert }
}

describe("GET /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await GET()).status).toBe(403)
  })

  it("returns null when the org has no practice, reading only its own practice row", async () => {
    const ordenes = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toEqual({ practica: null })
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", true)
  })

  it("returns the practice mapped for the wizard", async () => {
    mockSupabaseFrom({ ordenes_servicio: createChainMock(filaPractica) })
    const { body } = await parseResponse(await GET())
    expect(body.practica).toEqual({
      id: "ord-p",
      estado: "RECIBIDO",
      publicToken: "a".repeat(32),
      tipoDispositivo: "CELULAR",
      dispositivo: "Moto G",
      problemaReportado: "No enciende",
      costoFinal: null,
    })
  })
})

describe("POST /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    // registrar_camino_onboarding is the only rpc this route calls.
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "practica", error: null } as any)
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await POST(createPostRequest(cuerpo))).status).toBe(403)
  })

  it("rejects a body without a tipo", async () => {
    prepararAlta()
    const { status, body } = await parseResponse(await POST(createPostRequest({})))
    expect(status).toBe(400)
    expect(body.error).toBe("Elegí el tipo de equipo")
  })

  it("rejects a tipo that is not an active tipo of the org", async () => {
    const { tipos, clienteInsert } = prepararAlta({ tipo: null })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(400)
    expect(tipos.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(tipos.eq).toHaveBeenCalledWith("activo", true)
    expect(clienteInsert).not.toHaveBeenCalled()
  })

  it("returns 409 when the org already has real orders", async () => {
    const { clienteInsert } = prepararAlta({ ordenesReales: 2 })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(409)
    expect(clienteInsert).not.toHaveBeenCalled()
    expect(deletePracticeData).not.toHaveBeenCalled()
  })

  it("creates the practice client without a phone and the practice order numbered 0", async () => {
    const { clienteInsert, ordenInsert } = prepararAlta()
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))

    expect(status).toBe(201)
    expect(clienteInsert).toHaveBeenCalledWith({
      organization_id: "org-1",
      nombre: "Luis",
      email: "luis@taller.com",
      telefono: "",
      acepta_whatsapp: false,
      es_practica: true,
    })
    const orden = ordenInsert.mock.calls[0][0]
    expect(orden).toMatchObject({
      numero_orden: 0,
      codigo_orden: "PRACTICA",
      es_practica: true,
      organization_id: "org-1",
      sucursal_id: "suc-1",
      cliente_id: "cli-p",
      tipo_dispositivo: "CELULAR",
      dispositivo: "Moto G",
      problema_reportado: "No enciende",
      estado: "RECIBIDO",
      recibido_por: "user-1",
    })
    expect(orden.public_token).toMatch(/^[0-9a-f]{32}$/)
    // Same as POST /api/ordenes (route.ts:389-428): expiry is never set on create.
    expect(orden).not.toHaveProperty("public_token_expires_at")
    expect(body.practica).toMatchObject({ id: "ord-p", estado: "RECIBIDO" })
  })

  it("replaces an existing practice before creating the new one", async () => {
    const { clienteInsert } = prepararAlta()
    await POST(createPostRequest(cuerpo))
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
    expect(vi.mocked(deletePracticeData).mock.invocationCallOrder[0]).toBeLessThan(
      clienteInsert.mock.invocationCallOrder[0]
    )
  })

  it("writes the creation event and queues one notification", async () => {
    const { eventoInsert } = prepararAlta()
    await POST(createPostRequest(cuerpo))

    expect(eventoInsert).toHaveBeenCalledTimes(1)
    expect(eventoInsert.mock.calls[0][0]).toMatchObject({
      orden_id: "ord-p",
      organization_id: "org-1",
      tipo: "CAMBIO_ESTADO",
      estado_nuevo: "RECIBIDO",
      created_by: "user-1",
    })
    expect(queueNotification).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(queueNotification).mock.calls[0][0]
    expect(arg.tipo).toBe("CAMBIO_ESTADO")
    expect(arg.context.orden).toMatchObject({ numeroOrden: 0, estado: "RECIBIDO", publicToken: "a".repeat(32) })
    expect(arg.context.cliente).toEqual({ id: "cli-p", nombre: "Luis", email: "luis@taller.com", telefono: "" })
  })

  // The onboarding_progress row may be missing (the new wizard no longer calls
  // GET /api/onboarding/progress) or present. Both cases are one SQL statement,
  // registrar_camino_onboarding (an upsert by organization_id). This test pins
  // that the route always uses it, and never a plain UPDATE that silently
  // matches 0 rows when the row is missing. The row-missing and row-present
  // behavior is tested in migration 348, autocheck (g).
  it("records camino practica with the upserting function, whether or not the row exists", async () => {
    prepararAlta()
    await POST(createPostRequest(cuerpo))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "practica",
    })
    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    expect(tablas).not.toContain("onboarding_progress")
  })

  it("still returns 201 when recording the camino fails", async () => {
    prepararAlta()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "rpc down" } } as any)
    expect((await POST(createPostRequest(cuerpo))).status).toBe(201)
  })

  it("returns the winning practice on a concurrent double submit", async () => {
    const { ordenInsert } = prepararAlta({ clienteError: { code: "23505", message: "duplicate" }, ganadora: filaPractica })
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(201)
    expect(body.practica.id).toBe("ord-p")
    expect(ordenInsert).not.toHaveBeenCalled()
  })

  it("deletes its own client when the order insert loses the race", async () => {
    const { clienteDelete, clientes } = prepararAlta({
      ordenError: { code: "23505", message: "duplicate" },
      ganadora: filaPractica,
    })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(201)
    expect(clienteDelete).toHaveBeenCalled()
    expect(clientes.eq).toHaveBeenCalledWith("id", "cli-p")
    expect(clientes.eq).toHaveBeenCalledWith("es_practica", true)
  })

  it("returns the winning practice when a concurrent cleanup deleted this submit's client (FK violation)", async () => {
    const { clienteDelete } = prepararAlta({
      ordenError: { code: "23503", message: "foreign key violation" },
      ganadora: filaPractica,
    })
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(201)
    expect(body.practica.id).toBe("ord-p")
    expect(clienteDelete).toHaveBeenCalled()
  })

  it("explains the 409 when a kept client without phone blocks the practice", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { clientes } = prepararAlta({
      clienteError: { code: "23505", message: "duplicate" },
      clienteSinTelefono: { id: "cli-real" },
    })
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(409)
    expect(body.error).toBe("Ya tenés un cliente cargado sin teléfono. Agregale un teléfono para poder repetir la práctica.")
    expect(clientes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(clientes.eq).toHaveBeenCalledWith("es_practica", false)
    expect(clientes.eq).toHaveBeenCalledWith("telefono", "")
    log.mockRestore()
  })

  it("keeps the generic 409 and logs the original error when there is no winner and no blocking client", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    prepararAlta({ clienteError: { code: "23505", message: "dup telefono" } })
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(409)
    expect(body.error).toContain("Probá de nuevo")
    expect(log.mock.calls.flat().join(" ")).toContain("23505")
    log.mockRestore()
  })

  it("logs the original error when the order insert loses and there is no winner", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    prepararAlta({ ordenError: { code: "23503", message: "fk gone" } })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(409)
    expect(log.mock.calls.flat().join(" ")).toContain("23503")
    log.mockRestore()
  })
})

describe("DELETE /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("deletes the org's practice", async () => {
    const { status, body } = await parseResponse(await DELETE())
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })

  it("returns 500 when the deletion fails", async () => {
    vi.mocked(deletePracticeData).mockRejectedValueOnce(new Error("rpc down"))
    const { status } = await parseResponse(await DELETE())
    expect(status).toBe(500)
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    expect((await DELETE()).status).toBe(403)
  })
})
