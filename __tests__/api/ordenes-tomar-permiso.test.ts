// @vitest-environment node
/**
 * `tomar` claims an order only when the access policy says the technician may claim it
 * (`permisos.tomar`: unassigned, his organization allows it, and his branch handles the order).
 * Today the scope alone implies it, because every order is handled by the branch that created it.
 * Once an order can be derived, a technician of the origin sees it and still must not claim it: the
 * route has to read the permission, so these tests make the loader answer "in scope, not claimable"
 * and check what the route does with it.
 */
import { describe, it, expect, vi } from "vitest"
import { mockAuthSuccess, createPostRequest } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock("@/lib/ordenes/alcance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ordenes/alcance")>()
  return { ...real, cargarOrdenEnAlcance: vi.fn(real.cargarOrdenEnAlcance) }
})

import { POST } from "@/app/api/ordenes/[id]/tomar/route"
import { cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { politicaOrden } from "@/lib/sucursal-ordenes"

const ORDEN = { id: "o-1", organization_id: "org-1", sucursal_id: "suc-A", tecnico_id: null as string | null, estado: "RECIBIDO" }

function montar() {
  vi.clearAllMocks()
  mockAuthSuccess({ role: "TECNICO", userId: "t-1", sucursalId: "suc-A" })
  return montarSupabaseEnMemoria({
    ordenes_servicio: [ORDEN],
    users: [{ id: "t-1", rol: "TECNICO", organization_id: "org-1", porcentaje_comision: 10, costo_hora: 100 }],
    organizations: [{ id: "org-1", tecnicos_toman_ordenes: true }],
  })
}

/** The loader answers: the order is in scope and the policy says `tomar` is `puede`. */
function elLoaderDice(puede: boolean, tecnicoId: string | null = null) {
  const orden = { ...ORDEN, tecnico_id: tecnicoId }
  const permisos = {
    ...politicaOrden({ userId: "t-1", role: "TECNICO", sucursalId: "suc-A", tomaSinAsignar: true }, { sucursalId: "suc-A", tecnicoId }, false),
    tomar: puede,
  }
  vi.mocked(cargarOrdenEnAlcance).mockResolvedValueOnce({ orden, permisos })
}

const tomarOrden = () => POST(createPostRequest({}), { params: Promise.resolve({ id: "o-1" }) })

describe("POST /api/ordenes/[id]/tomar - the policy decides", () => {
  it("an order in scope that his branch does not handle is not found, and nothing is claimed", async () => {
    const mem = montar()
    elLoaderDice(false)

    const res = await tomarOrden()

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Orden no encontrada" })
    expect(mem.escrituras).toEqual([])
  })

  it("an order the policy lets him claim is claimed", async () => {
    const mem = montar()
    elLoaderDice(true)

    const res = await tomarOrden()

    expect(res.status).toBe(200)
    expect(mem.escrituras).toContainEqual(
      expect.objectContaining({ tabla: "ordenes_servicio", operacion: "update", carga: expect.objectContaining({ tecnico_id: "t-1" }) }),
    )
  })

  it("an order that already has a technician is still a conflict, whatever the permission says", async () => {
    const mem = montar()
    elLoaderDice(false, "t-2")

    expect((await tomarOrden()).status).toBe(409)
    expect(mem.escrituras).toEqual([])
  })
})
