/**
 * Un termino generico ("a", "29") en una organizacion con miles de clientes
 * metia todos los ids coincidentes en `cliente_id.in.(...)`: la URL superaba
 * el limite del gateway y PostgREST devolvia 400 "Bad Request" (listado vacio).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { tablaPostgrest } from "../helpers/postgrest-memoria"
import { GET } from "@/app/api/ordenes/route"
import { MAX_CLIENTES_EN_BUSQUEDA } from "@/lib/busqueda-clientes"

vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))

const id = (i: number) => `cli-${String(i).padStart(5, "0")}`

function orden(ordenId: string, clienteId: string) {
  return {
    id: ordenId,
    organization_id: "org-1",
    sucursal_id: "suc-1",
    tecnico_id: null,
    estado: "EN_REPARACION",
    numero_orden: 1,
    codigo_orden: "CEL-001",
    dispositivo: "Galaxy S21",
    marca: "Samsung",
    imei: null,
    fecha_ingreso: "2026-11-10T10:00:00Z",
    presupuesto: 1000,
    sena: 0,
    cliente_id: clienteId,
    clientes: null,
    users: null,
  }
}

describe("GET /api/ordenes?search con muchos clientes coincidentes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as any)
  })

  it(`no mete mas de ${MAX_CLIENTES_EN_BUSQUEDA} ids en el filtro y prioriza los clientes mas recientes`, async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const clientes = Array.from({ length: 1500 }, (_, i) => ({
      id: id(i),
      organization_id: "org-1",
      nombre: `Cliente ${i}`,
      telefono: `29${i}`,
    }))
    const tabla = tablaPostgrest([orden("del-mas-nuevo", id(1499)), orden("del-mas-viejo", id(0))])
    mockSupabaseFrom({
      ordenes_servicio: tabla,
      organizations: createChainMock({ tecnicos_toman_ordenes: false }),
      clientes: tablaPostgrest(clientes),
    } as any)

    const res = await GET(new Request("http://localhost:3000/api/ordenes?search=29"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    const filtro = tabla.consultas.flatMap((c) => c.or).join(",")
    const lista = filtro.match(/cliente_id\.in\.\(([^)]*)\)/)?.[1] ?? ""
    expect(lista.split(",").length).toBe(MAX_CLIENTES_EN_BUSQUEDA)
    expect(lista).toContain(id(1499))
    expect(lista).not.toContain(id(0))
    expect((body.data ?? []).map((o: any) => o.id)).toEqual(["del-mas-nuevo"])
  })
})
