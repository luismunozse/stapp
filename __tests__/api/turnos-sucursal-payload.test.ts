// @vitest-environment node
/**
 * The appointment payload carries the branch the appointment belongs to (`sucursalId`), so the
 * edit dialog can list the technicians of THAT branch instead of the request's write scope.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET as listar } from "@/app/api/turnos/route"
import { GET as uno } from "@/app/api/turnos/[id]/route"

function fila(sucursal: string | null) {
  return {
    id: "turno-1",
    organization_id: "org-1",
    sucursal_id: sucursal,
    cliente_id: "c1",
    cliente_snapshot: null,
    tecnico_id: "tec-1",
    inicio: "2026-11-02T13:00:00.000Z",
    fin: null,
    direccion: null,
    tipo: "visita_diagnostico",
    tipo_dispositivo: null,
    marca: null,
    modelo: null,
    problema_reportado: null,
    fotos_previas: [],
    estado: "agendado",
    orden_id: null,
    notas: null,
    created_by: "adm",
    created_at: "2026-10-27T00:00:00Z",
    updated_at: "2026-10-27T00:00:00Z",
    clientes: null,
    users: { id: "tec-1", nombre: "Ana" },
    ordenes_servicio: null,
  }
}

describe("turnos payload - sucursalId", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([["suc-A"], ["suc-B"]])("the list carries the branch of each appointment (%s)", async (sucursal) => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    const turnos = createChainMock([fila(sucursal)])
    turnos.then = (resolve: any) => resolve({ data: [fila(sucursal)], error: null })
    mockSupabaseFrom({ turnos, organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }) })

    const { status, body } = await parseResponse(await listar(createGetRequest("http://localhost:3000/api/turnos")))

    expect(status).toBe(200)
    expect(body.turnos[0].sucursalId).toBe(sucursal)
  })

  it("the detail carries it too", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    const turnos = createChainMock(null)
    turnos.maybeSingle = vi.fn().mockResolvedValue({ data: fila("suc-B"), error: null })
    mockSupabaseFrom({ turnos })

    const res = await uno(createGetRequest(), { params: Promise.resolve({ id: "turno-1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.sucursalId).toBe("suc-B")
  })
})
