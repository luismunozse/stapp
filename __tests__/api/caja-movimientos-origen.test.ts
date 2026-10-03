import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  createGetRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { DELETE } from "@/app/api/caja/movimientos/[id]/route"
import { GET, POST } from "@/app/api/caja/movimientos/route"
import { registrarEgresoCajaEfectivo } from "@/lib/caja-utils"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const deleteReq = () =>
  new Request("http://localhost/api/caja/movimientos/m1", { method: "DELETE" })

const COLUMNA_AUSENTE = {
  code: "42703",
  message: "column movimientos_caja.origen does not exist",
}
const PGRST204_ORIGEN = {
  code: "PGRST204",
  message: "Could not find the 'origen' column of 'movimientos_caja' in the schema cache",
}

function filaMovimiento(extra: Record<string, unknown>) {
  return {
    id: "m1",
    sucursal_id: null,
    sesion_caja_id: "ses-1",
    sesiones_caja: { id: "ses-1", estado: "ABIERTA" },
    ...extra,
  }
}

function setupDelete(single: any[]) {
  const movChain = createChainMock(null)
  movChain.single = vi.fn()
  for (const r of single) movChain.single.mockResolvedValueOnce(r)
  mockSupabaseFrom({ movimientos_caja: movChain })
  return movChain
}

describe("DELETE /api/caja/movimientos/[id] — guard por origen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  for (const origen of ["DEVOLUCION", "NOTA_CREDITO", "COGS"]) {
    it(`bloquea con 409 un movimiento ${origen} y NO lo borra`, async () => {
      const chain = setupDelete([{ data: filaMovimiento({ origen }), error: null }])

      const res = await DELETE(deleteReq(), params("m1"))
      const { status, body } = await parseResponse(res)

      expect(status).toBe(409)
      expect(body.error).toMatch(/sistema/i)
      expect(chain.delete).not.toHaveBeenCalled()
    })
  }

  it("el SELECT pide la columna origen", async () => {
    const chain = setupDelete([{ data: filaMovimiento({ origen: "MANUAL" }), error: null }])

    await DELETE(deleteReq(), params("m1"))

    const cols = vi.mocked(chain.select).mock.calls[0][0] as string
    expect(cols).toContain("origen")
  })

  it("borra un movimiento MANUAL", async () => {
    const chain = setupDelete([{ data: filaMovimiento({ origen: "MANUAL" }), error: null }])

    const res = await DELETE(deleteReq(), params("m1"))

    expect((await parseResponse(res)).status).toBe(200)
    expect(chain.delete).toHaveBeenCalledTimes(1)
  })

  it("permite borrar un RECURRENTE (cancelar un gasto materializado)", async () => {
    const chain = setupDelete([{ data: filaMovimiento({ origen: "RECURRENTE" }), error: null }])

    const res = await DELETE(deleteReq(), params("m1"))

    expect((await parseResponse(res)).status).toBe(200)
    expect(chain.delete).toHaveBeenCalledTimes(1)
  })

  it("sin la migracion (42703): reintenta sin origen y bloquea por prefijo de concepto", async () => {
    const chain = setupDelete([
      { data: null, error: COLUMNA_AUSENTE },
      {
        data: filaMovimiento({
          tipo: "EGRESO",
          afecta_rentabilidad: false,
          concepto: "Devolución DEV-0007",
        }),
        error: null,
      },
    ])

    const res = await DELETE(deleteReq(), params("m1"))

    expect((await parseResponse(res)).status).toBe(409)
    expect(chain.delete).not.toHaveBeenCalled()
    const segundoSelect = vi.mocked(chain.select).mock.calls[1][0] as string
    expect(segundoSelect).not.toContain("origen")
    expect(segundoSelect).toContain("concepto")
  })

  it("sin la migracion: un Retiro de socio manual SI se puede borrar", async () => {
    const chain = setupDelete([
      { data: null, error: COLUMNA_AUSENTE },
      {
        data: filaMovimiento({
          tipo: "EGRESO",
          afecta_rentabilidad: false,
          concepto: "Retiro de socio",
        }),
        error: null,
      },
    ])

    const res = await DELETE(deleteReq(), params("m1"))

    expect((await parseResponse(res)).status).toBe(200)
    expect(chain.delete).toHaveBeenCalledTimes(1)
  })

  it("404 si el movimiento no existe", async () => {
    setupDelete([{ data: null, error: { code: "PGRST116", message: "no rows" } }])

    const res = await DELETE(deleteReq(), params("m1"))

    expect((await parseResponse(res)).status).toBe(404)
  })
})

describe("GET /api/caja/movimientos — devuelve origen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("expone origen y asume MANUAL cuando la columna no existe", async () => {
    const base = {
      tipo: "EGRESO",
      monto: "10",
      metodo_pago: "EFECTIVO",
      observaciones: null,
      usuario_id: "u1",
      fecha: "2026-01-01T10:00:00Z",
      afecta_rentabilidad: false,
      users: null,
      categorias_gasto: null,
    }
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      movimientos_caja: createChainMock([
        { ...base, id: "a", concepto: "Devolución DEV-1", origen: "DEVOLUCION" },
        { ...base, id: "b", concepto: "Retiro de socio" },
      ]),
    })

    const res = await GET(
      createGetRequest("http://localhost/api/caja/movimientos?fecha=2026-01-01")
    )
    const { body } = await parseResponse(res)

    expect(body.movimientos.map((m: any) => [m.id, m.origen])).toEqual([
      ["a", "DEVOLUCION"],
      ["b", "MANUAL"],
    ])
  })

  it("sin la columna, infiere el origen por el concepto (la UI oculta el borrado igual)", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      movimientos_caja: createChainMock([
        {
          id: "a",
          tipo: "EGRESO",
          monto: "10",
          metodo_pago: "EFECTIVO",
          concepto: "Nota de crédito NC-0003",
          observaciones: null,
          usuario_id: "u1",
          fecha: "2026-01-01T10:00:00Z",
          afecta_rentabilidad: false,
          users: null,
          categorias_gasto: null,
        },
      ]),
    })

    const res = await GET(
      createGetRequest("http://localhost/api/caja/movimientos?fecha=2026-01-01")
    )
    const { body } = await parseResponse(res)

    expect(body.movimientos[0].origen).toBe("NOTA_CREDITO")
  })
})

describe("POST /api/caja/movimientos — origen MANUAL", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
  })

  const body = { tipo: "INGRESO", monto: 100, metodoPago: "EFECTIVO", concepto: "Aporte" }

  function setup(results: Array<{ data: any; error: any }>) {
    const payloads: any[] = []
    const single = vi.fn()
    for (const r of results) single.mockResolvedValueOnce(r)
    const chain: any = {
      insert: vi.fn().mockImplementation((p: any) => {
        payloads.push(p)
        return chain
      }),
      single,
    }
    chain.select = vi.fn().mockReturnValue(chain)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }),
      sesiones_caja: createChainMock(null),
      movimientos_caja: chain,
    })
    return payloads
  }

  it("escribe origen MANUAL explicito", async () => {
    const payloads = setup([{ data: { id: "m1" }, error: null }])

    const res = await POST(createPostRequest(body, "http://localhost/api/caja/movimientos"))

    expect((await parseResponse(res)).status).toBe(201)
    expect(payloads[0]).toMatchObject({ origen: "MANUAL" })
  })

  it("sin la migracion (PGRST204): reintenta sin origen y el movimiento se crea", async () => {
    const payloads = setup([
      { data: null, error: PGRST204_ORIGEN },
      { data: { id: "m1" }, error: null },
    ])

    const res = await POST(createPostRequest(body, "http://localhost/api/caja/movimientos"))

    expect((await parseResponse(res)).status).toBe(201)
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).not.toHaveProperty("origen")
    expect(payloads[1]).toMatchObject({ concepto: "Aporte", organization_id: "org-1" })
  })

  it("un error que no es de la columna origen NO reintenta", async () => {
    const payloads = setup([{ data: null, error: { code: "23503", message: "fk" } }])

    const res = await POST(createPostRequest(body, "http://localhost/api/caja/movimientos"))

    expect((await parseResponse(res)).status).toBe(500)
    expect(payloads).toHaveLength(1)
  })
})

describe("registrarEgresoCajaEfectivo — origen", () => {
  beforeEach(() => vi.clearAllMocks())

  function setup(insertResults: any[]) {
    const payloads: any[] = []
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sesiones_caja") return createChainMock({ id: "ses-1" }) as any
      return {
        insert: vi.fn().mockImplementation((p: any) => {
          payloads.push(p)
          return Promise.resolve(insertResults.shift() ?? { data: null, error: null })
        }),
      } as any
    })
    return payloads
  }

  const base = {
    organizationId: "org-1",
    userId: "u-1",
    sucursalId: "suc-1",
    monto: 50,
    metodoPago: "EFECTIVO",
    concepto: "Devolución DEV-1",
  }

  it("escribe el origen recibido", async () => {
    const payloads = setup([])
    await registrarEgresoCajaEfectivo({ ...base, origen: "NOTA_CREDITO" })
    expect(payloads[0]).toMatchObject({ origen: "NOTA_CREDITO", tipo: "EGRESO" })
  })

  it("sin la migracion reintenta sin origen: el egreso del reembolso no se pierde", async () => {
    const payloads = setup([{ data: null, error: PGRST204_ORIGEN }])
    await registrarEgresoCajaEfectivo({ ...base, origen: "DEVOLUCION" })
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).not.toHaveProperty("origen")
    expect(payloads[1]).toMatchObject({ monto: 50, concepto: "Devolución DEV-1" })
  })
})
