// @vitest-environment node
/**
 * BM-5 on an appointment (turno): the technician it is assigned to must belong to the appointment's
 * branch, unless he is an ADMIN or is already the assigned one (a legacy cross-branch assignment
 * survives an edit of another field). The same rule the order has, applied to PATCH /api/turnos/[id].
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MENSAJE_TECNICO_OTRA_SUCURSAL_TURNO } from "@/lib/sucursal-ordenes"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { PATCH } from "@/app/api/turnos/[id]/route"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock("@/lib/turnos/notifications", () => ({ notifyTurno: vi.fn().mockResolvedValue(undefined) }))

const A = "suc-A"
const B = "suc-B"

const turno = (tecnicoId: string | null) => ({
  id: "turno-1",
  organization_id: "org-1",
  sucursal_id: A,
  estado: "agendado",
  orden_id: null,
  tecnico_id: tecnicoId,
  cliente_id: null,
  inicio: "2026-10-20T10:00:00.000Z",
  fin: null,
  direccion: null,
  tipo: "visita_diagnostico",
  tipo_dispositivo: null,
  marca: null,
  modelo: null,
  problema_reportado: null,
  fotos_previas: [],
  notas: null,
  created_by: "u-1",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  clientes: null,
  users: null,
  ordenes_servicio: null,
})

const usuario = (id: string, rol: string, sucursal: string | null) => ({ id, organization_id: "org-1", rol, sucursal_id: sucursal, nombre: id })
const USUARIOS = [
  usuario("t-a", "TECNICO", A),
  usuario("t-b", "TECNICO", B),
  usuario("t-b2", "TECNICO", B),
  usuario("admin-1", "ADMIN", null),
]

async function parchar(cuerpo: Record<string, unknown>, tecnicoActual: string | null = null, role = "VENDEDOR") {
  mockAuthSuccess({ role, userId: "u-1", sucursalId: role === "ADMIN" ? null : A })
  const memoria = montarSupabaseEnMemoria({ turnos: [turno(tecnicoActual)], users: USUARIOS })
  const res = await PATCH(
    new Request("http://localhost:3000/api/turnos/turno-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ id: "turno-1" }) },
  )
  const { status, body } = await parseResponse(res)
  return { status, body, escrituras: memoria.escrituras.filter((e) => e.tabla === "turnos"), turnos: memoria.filas("turnos") }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PATCH /api/turnos/[id]: the assigned technician belongs to the appointment's branch (BM-5)", () => {
  it.each([
    ["a VENDEDOR", "VENDEDOR"],
    ["an ADMIN", "ADMIN"],
  ])("%s assigning a technician of ANOTHER branch: 400 and nothing is written", async (_quien, role) => {
    const { status, body, escrituras, turnos } = await parchar({ tecnicoId: "t-b" }, null, role)
    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE_TECNICO_OTRA_SUCURSAL_TURNO)
    expect(escrituras).toEqual([])
    expect(turnos[0].tecnico_id).toBeNull()
  })

  it("a technician of the appointment's branch is assigned", async () => {
    const { status, turnos } = await parchar({ tecnicoId: "t-a" })
    expect(status).toBe(200)
    expect(turnos[0].tecnico_id).toBe("t-a")
  })

  it("an ADMIN user can be assigned: he belongs to no branch", async () => {
    const { status, turnos } = await parchar({ tecnicoId: "admin-1" })
    expect(status).toBe(200)
    expect(turnos[0].tecnico_id).toBe("admin-1")
  })

  it("an existing cross-branch assignment survives an edit that leaves the technician as he is", async () => {
    const { status, turnos } = await parchar({ tecnicoId: "t-b", notas: "llevar cargador" }, "t-b")
    expect(status).toBe(200)
    expect(turnos[0]).toMatchObject({ tecnico_id: "t-b", notas: "llevar cargador" })
  })

  it("but moving it to ANOTHER technician of that other branch is refused", async () => {
    const { status, body, escrituras } = await parchar({ tecnicoId: "t-b2" }, "t-b")
    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE_TECNICO_OTRA_SUCURSAL_TURNO)
    expect(escrituras).toEqual([])
  })

  it("clearing the technician needs no check", async () => {
    const { status, turnos } = await parchar({ tecnicoId: null }, "t-b")
    expect(status).toBe(200)
    expect(turnos[0].tecnico_id).toBeNull()
  })

  it("a technician that does not exist is still 'Técnico inválido'", async () => {
    const { status, body } = await parchar({ tecnicoId: "nadie" })
    expect(status).toBe(400)
    expect(body.error).toBe("Técnico inválido")
  })
})
