import { describe, it, expect, vi, beforeAll } from "vitest"
import { ORDEN_PRACTICA_ERROR } from "@/lib/onboarding/practica-shared"

type Practica = typeof import("@/lib/onboarding/practica")

// vitest.setup.ts swaps deletePracticeData and rejectIfPractica for no-op mocks so
// that route suites are not affected; this file needs the real implementations.
let real: Practica
beforeAll(async () => {
  real = await vi.importActual<Practica>("@/lib/onboarding/practica")
})

type Resultado = { data?: unknown; error?: { message: string } | null; count?: number }

function clienteFalso(resultado: Resultado = {}) {
  const final = { data: resultado.data ?? null, error: resultado.error ?? null, count: resultado.count }
  const chain: Record<string, any> = {}
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => final)
  chain.then = (resolve: (v: typeof final) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(final).then(resolve, reject)
  const client = {
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => ({ data: final.data, error: final.error })),
  }
  return { client: client as any, chain }
}

const fila = {
  id: "ord-p",
  estado: "RECIBIDO",
  public_token: "b".repeat(32),
  tipo_dispositivo: "CELULAR",
  dispositivo: "Moto G",
  problema_reportado: "No enciende",
  costo_final: null,
}

describe("toPracticaOrden", () => {
  it("maps the row to the wizard contract", () => {
    expect(real.toPracticaOrden(fila)).toEqual({
      id: "ord-p",
      estado: "RECIBIDO",
      publicToken: "b".repeat(32),
      tipoDispositivo: "CELULAR",
      dispositivo: "Moto G",
      problemaReportado: "No enciende",
      costoFinal: null,
    })
  })

  it("parses the DECIMAL cost and shows a half-done repair as RECIBIDO", () => {
    expect(real.toPracticaOrden({ ...fila, estado: "EN_REPARACION", costo_final: "15000.00" })).toMatchObject({
      estado: "RECIBIDO",
      costoFinal: 15000,
    })
  })
})

describe("getPracticaOrdenRow", () => {
  it("returns the raw row with the clientes embed", async () => {
    const rowConCliente = { ...fila, clientes: { id: "cli-p", nombre: "Ana", email: "ana@x.com" } }
    const { client, chain } = clienteFalso({ data: rowConCliente })
    await expect(real.getPracticaOrdenRow("org-1", client)).resolves.toEqual(rowConCliente)
    expect(chain.select).toHaveBeenCalledWith(real.PRACTICA_ORDEN_SELECT)
    expect(real.PRACTICA_ORDEN_SELECT).toContain("clientes (id, nombre, email)")
  })

  it("returns null when the org has no practice", async () => {
    const { client } = clienteFalso({ data: null })
    await expect(real.getPracticaOrdenRow("org-1", client)).resolves.toBeNull()
  })

  it("throws on a database error", async () => {
    const { client } = clienteFalso({ error: { message: "boom" } })
    await expect(real.getPracticaOrdenRow("org-1", client)).rejects.toThrow("boom")
  })
})

describe("getPracticaOrden", () => {
  it("reads only the caller org's practice row", async () => {
    const { client, chain } = clienteFalso({ data: fila })
    const practica = await real.getPracticaOrden("org-1", client)
    expect(client.from).toHaveBeenCalledWith("ordenes_servicio")
    expect(chain.select).toHaveBeenCalledWith(real.PRACTICA_ORDEN_SELECT)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("es_practica", true)
    expect(practica?.id).toBe("ord-p")
  })

  it("returns null when the org has no practice", async () => {
    const { client } = clienteFalso({ data: null })
    await expect(real.getPracticaOrden("org-1", client)).resolves.toBeNull()
  })

  it("throws on a database error", async () => {
    const { client } = clienteFalso({ error: { message: "boom" } })
    await expect(real.getPracticaOrden("org-1", client)).rejects.toThrow("boom")
  })
})

describe("deletePracticeData", () => {
  it("delegates to borrar_datos_practica and reports a client kept for real work", async () => {
    const { client } = clienteFalso({ data: { orden_borrada: true, cliente_conservado: true } })
    await expect(real.deletePracticeData("org-1", client)).resolves.toEqual({
      ordenBorrada: true,
      clienteConservado: true,
    })
    expect(client.rpc).toHaveBeenCalledWith("borrar_datos_practica", { p_org_id: "org-1" })
  })

  it("reports nothing deleted when the org had no practice", async () => {
    const { client } = clienteFalso({ data: { orden_borrada: false, cliente_conservado: false } })
    await expect(real.deletePracticeData("org-1", client)).resolves.toEqual({
      ordenBorrada: false,
      clienteConservado: false,
    })
  })

  it("throws on an RPC error so each caller decides", async () => {
    const { client } = clienteFalso({ error: { message: "rpc down" } })
    await expect(real.deletePracticeData("org-1", client)).rejects.toThrow("rpc down")
  })
})

describe("rejectIfPractica", () => {
  it("returns 409 ORDEN_PRACTICA for a practice order", async () => {
    const { client, chain } = clienteFalso({ data: { id: "ord-p", es_practica: true } })
    const res = await real.rejectIfPractica("ord-p", "org-1", client)
    expect(res?.status).toBe(409)
    expect(await res?.json()).toEqual(ORDEN_PRACTICA_ERROR)
    expect(chain.select).toHaveBeenCalledWith("id, es_practica")
  })

  it("lets a real order through", async () => {
    const { client } = clienteFalso({ data: { id: "ord-1", es_practica: false } })
    await expect(real.rejectIfPractica("ord-1", "org-1", client)).resolves.toBeNull()
  })

  it("never looks outside the caller's org", async () => {
    // Another org's practice id is "not found" under this org; the route's own 404 handles it.
    const { client, chain } = clienteFalso({ data: null })
    await expect(real.rejectIfPractica("ord-ajena", "org-1", client)).resolves.toBeNull()
    expect(chain.eq).toHaveBeenCalledWith("id", "ord-ajena")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("fails open on a database error and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = clienteFalso({ error: { message: "column missing" } })
    await expect(real.rejectIfPractica("ord-1", "org-1", client)).resolves.toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe("countRealOrders", () => {
  it("counts only the org's non-practice orders", async () => {
    const { client, chain } = clienteFalso({ count: 3 })
    await expect(real.countRealOrders("org-1", client)).resolves.toBe(3)
    expect(chain.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("es_practica", false)
  })

  it("throws on a database error", async () => {
    const { client } = clienteFalso({ error: { message: "boom" } })
    await expect(real.countRealOrders("org-1", client)).rejects.toThrow("boom")
  })
})

describe("registrarCamino", () => {
  it("records the camino through the upserting function", async () => {
    const { client } = clienteFalso({ data: "practica" })
    await expect(real.registrarCamino("org-1", "practica", client)).resolves.toBeUndefined()
    expect(client.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "practica",
    })
  })

  it("logs and swallows an RPC error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = clienteFalso({ error: { message: "rpc down" } })
    await expect(real.registrarCamino("org-1", "real", client)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it("logs and swallows a thrown error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = clienteFalso()
    client.rpc.mockRejectedValueOnce(new Error("network"))
    await expect(real.registrarCamino("org-1", "omitido", client)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
