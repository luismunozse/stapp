// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

const requireSuperadmin = vi.fn()
const ticketReply = vi.fn().mockResolvedValue(undefined)
const sendSupportReplyEmail = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/superadmin-auth", () => ({ requireSuperadmin: () => requireSuperadmin() }))
vi.mock("@/lib/superadmin-audit", () => ({
  createSuperadminAuditLogger: () => ({ ticketReply }),
}))
vi.mock("@/lib/email", () => ({
  sendSupportReplyEmail: (...args: unknown[]) => sendSupportReplyEmail(...args),
}))

import { POST } from "@/app/api/superadmin/beta-android/contactar/route"
import { BETA_ASUNTO_CONTACTO } from "@/lib/android-beta"

const OK = { error: null, email: "admin@stapp.com.ar", userId: "sa1" }
const FILA = {
  id: "b1",
  user_id: "u1",
  organization_id: "o1",
  users: { nombre: "Ana Gómez", email: "ana@taller.com" },
  organizations: { nombre: "Taller Uno", slug: "talleruno" },
}

function post(body: unknown) {
  return new Request("http://localhost/api/superadmin/beta-android/contactar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Cadena cuyo maybeSingle (buscar) y single (crear) responden distinto. */
function cadena(buscar: unknown, crear: unknown = null, crearError: unknown = null) {
  const c = createChainMock(null)
  c.maybeSingle = vi.fn().mockResolvedValue({ data: buscar, error: null })
  c.single = vi.fn().mockResolvedValue({ data: crear, error: crearError })
  return c
}

describe("superadmin beta-android: contactar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    requireSuperadmin.mockResolvedValue(OK)
  })

  it.each([401, 403])("sin superadmin (%i) corta y no escribe ni manda mail", async (status) => {
    requireSuperadmin.mockResolvedValue({
      error: NextResponse.json({ error: "Acceso denegado" }, { status }),
      email: null,
      userId: null,
    })
    const mensajes = createChainMock(null)
    mockSupabaseFrom({ support_ticket_messages: mensajes })
    const res = await POST(post({ id: "b1", mensaje: "hola" }))
    expect(res.status).toBe(status)
    expect(mensajes.insert).not.toHaveBeenCalled()
    expect(sendSupportReplyEmail).not.toHaveBeenCalled()
  })

  it("mensaje vacío: 400 y no toca la base", async () => {
    const testers = cadena(FILA)
    mockSupabaseFrom({ android_beta_testers: testers })
    const res = await POST(post({ id: "b1", mensaje: "   " }))
    expect(res.status).toBe(400)
    expect(testers.select).not.toHaveBeenCalled()
  })

  it("inscripto inexistente: 404 y no crea nada", async () => {
    const tickets = cadena(null)
    mockSupabaseFrom({ android_beta_testers: cadena(null), support_tickets: tickets })
    const res = await POST(post({ id: "nope", mensaje: "hola" }))
    expect(res.status).toBe(404)
    expect(tickets.insert).not.toHaveBeenCalled()
  })

  it("sin conversación previa: crea el ticket del usuario, el mensaje de soporte y avisa por mail", async () => {
    const tickets = cadena(null, { id: "t1" })
    const mensajes = createChainMock(null)
    mockSupabaseFrom({
      android_beta_testers: cadena(FILA),
      support_tickets: tickets,
      support_ticket_messages: mensajes,
    })

    const { status, body } = await parseResponse(await POST(post({ id: "b1", mensaje: " Hola Ana " })))

    expect(status).toBe(201)
    expect(body).toEqual({ ticketId: "t1", nuevo: true })
    expect(tickets.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "o1",
        user_id: "u1",
        asunto: BETA_ASUNTO_CONTACTO,
        estado: "EN_PROCESO",
      })
    )
    expect(mensajes.insert).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: "t1", autor_tipo: "SUPERADMIN", contenido: "Hola Ana" })
    )
    expect(sendSupportReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ana@taller.com", ticketId: "t1", slug: "talleruno" })
    )
    expect(ticketReply).toHaveBeenCalledWith("t1", "Taller Uno")
  })

  it("con una conversación de la beta abierta: escribe ahí y no crea otra", async () => {
    const tickets = cadena({ id: "t9" })
    const mensajes = createChainMock(null)
    mockSupabaseFrom({
      android_beta_testers: cadena(FILA),
      support_tickets: tickets,
      support_ticket_messages: mensajes,
    })

    const { status, body } = await parseResponse(await POST(post({ id: "b1", mensaje: "¿Pudiste instalarla?" })))

    expect(status).toBe(201)
    expect(body).toEqual({ ticketId: "t9", nuevo: false })
    expect(tickets.insert).not.toHaveBeenCalled()
    // Solo reusa la del mismo usuario, con el asunto de la beta y sin cerrar.
    expect(tickets.eq).toHaveBeenCalledWith("user_id", "u1")
    expect(tickets.eq).toHaveBeenCalledWith("asunto", BETA_ASUNTO_CONTACTO)
    expect(tickets.neq).toHaveBeenCalledWith("estado", "CERRADO")
    expect(mensajes.insert).toHaveBeenCalledWith(expect.objectContaining({ ticket_id: "t9" }))
  })

  it("si falla guardar el mensaje responde 500 y no manda mail", async () => {
    mockSupabaseFrom({
      android_beta_testers: cadena(FILA),
      support_tickets: cadena({ id: "t9" }),
      support_ticket_messages: createChainMock(null, { message: "boom" }),
    })
    const res = await POST(post({ id: "b1", mensaje: "hola" }))
    expect(res.status).toBe(500)
    expect(sendSupportReplyEmail).not.toHaveBeenCalled()
  })
})
