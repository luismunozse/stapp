/**
 * Customer detail + account statement: order references follow the caller's
 * branch. The customer record itself (and its overall balance) stays org-wide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/cuenta-corriente-react-pdf", () => ({
  generateResumenCCPDF: vi.fn(async () => Buffer.from("pdf")),
  generateReciboCCPDF: vi.fn(async () => Buffer.from("pdf")),
}))

import { generateResumenCCPDF } from "@/lib/cuenta-corriente-react-pdf"
import { GET as getCliente } from "@/app/api/clientes/[id]/route"
import { GET as getCC } from "@/app/api/clientes/[id]/cuenta-corriente/route"
import { GET as getResumen } from "@/app/api/clientes/[id]/cuenta-corriente/resumen/route"
import { GET as getRecibo } from "@/app/api/clientes/[id]/cuenta-corriente/[movimientoId]/recibo/route"

const S1 = "sucursal-1"
const U1 = "user-1"
const params = () => ({ params: Promise.resolve({ id: "cli-1" }) })
const paramsMov = () => ({ params: Promise.resolve({ id: "cli-1", movimientoId: "mov-1" }) })

describe("GET /api/clientes/[id] embedded orders", () => {
  let clientes: ReturnType<typeof createChainMock>
  beforeEach(() => {
    clientes = createChainMock({ id: "cli-1", nombre: "Ana", ordenes_servicio: [], sectores_cliente: [] })
    mockSupabaseFrom({ clientes })
  })

  it("ADMIN: no order filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await getCliente(createGetRequest(), params())
    expect(clientes.or).not.toHaveBeenCalled()
    expect(clientes.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })

  it("VENDEDOR: embedded orders limited to the current branch, customer still returned", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await getCliente(createGetRequest(), params()))
    expect(status).toBe(200)
    expect(clientes.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
  })

  it("TECNICO: embedded orders limited to branch or assigned", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await getCliente(createGetRequest(), params())
    expect(clientes.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, {
      referencedTable: "ordenes_servicio",
    })
  })
})

describe("customer account statement lines", () => {
  let cc: ReturnType<typeof createChainMock>
  let clientes: ReturnType<typeof createChainMock>
  beforeEach(() => {
    cc = createChainMock([])
    clientes = createChainMock({ id: "cli-1", nombre: "Ana", saldo_cuenta: "100" })
    mockSupabaseFrom({
      cuenta_corriente: cc,
      clientes,
      organizations: createChainMock({ nombre: "Org", zona_horaria: "UTC" }),
    })
  })

  it("list: ADMIN sees every line", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await getCC(createGetRequest(), params())
    expect(cc.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(cc.or).not.toHaveBeenCalled()
  })

  it("list: non-admin sees only lines of their branch, balance stays org-wide", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(await getCC(createGetRequest(), params()))
    expect(cc.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},sucursal_id.is.null`)
    expect(body.saldo).toBe(100)
  })

  it("list: non-admin without a branch matches nothing (unattributed lines stay hidden too)", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: null })
    await getCC(createGetRequest(), params())
    expect(cc.or).not.toHaveBeenCalled()
    expect(cc.eq).toHaveBeenCalledWith("sucursal_id", "00000000-0000-0000-0000-000000000000")
  })

  it("statement PDF: non-admin lines are branch-scoped (opening balance query too)", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    await getResumen(createGetRequest("http://localhost/api/x?desde=2026-01-01&hasta=2026-01-31"), params())
    expect(cc.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},sucursal_id.is.null`)
  })

  it("statement PDF: non-admin gets no running balances, only movements plus the org-wide balance", async () => {
    vi.mocked(generateResumenCCPDF).mockClear()
    cc = createChainMock([
      { tipo: "PAGO", monto: "50", saldo_posterior: "-999", created_at: "2026-01-02T00:00:00Z" },
    ])
    mockSupabaseFrom({
      cuenta_corriente: cc,
      clientes: createChainMock({ nombre: "Ana", saldo_cuenta: "100" }),
      organizations: createChainMock({ nombre: "Org", zona_horaria: "UTC" }),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    await getResumen(createGetRequest("http://localhost/api/x?desde=2026-01-01&hasta=2026-01-31"), params())
    const arg = vi.mocked(generateResumenCCPDF).mock.calls[0][0]
    expect(arg.sinSaldosAcumulados).toBe(true)
    expect(arg.saldoFinal).toBe(100)
    expect(arg.saldoInicial).toBe(0)
    expect(arg.movimientos).toHaveLength(1)
    expect(arg.movimientos[0].saldoPosterior).toBe(0)
    // No opening-balance lookup either.
    expect(cc.lt).not.toHaveBeenCalled()
  })

  it("statement PDF: ADMIN keeps the ledger running balances", async () => {
    vi.mocked(generateResumenCCPDF).mockClear()
    cc = createChainMock([
      { tipo: "PAGO", monto: "50", saldo_posterior: "-999", created_at: "2026-01-02T00:00:00Z" },
    ])
    mockSupabaseFrom({
      cuenta_corriente: cc,
      clientes: createChainMock({ nombre: "Ana", saldo_cuenta: "100" }),
      organizations: createChainMock({ nombre: "Org", zona_horaria: "UTC" }),
    })
    mockAuthSuccess({ role: "ADMIN" })
    await getResumen(createGetRequest("http://localhost/api/x?desde=2026-01-01&hasta=2026-01-31"), params())
    const arg = vi.mocked(generateResumenCCPDF).mock.calls[0][0]
    expect(arg.sinSaldosAcumulados).toBeFalsy()
    expect(arg.movimientos[0].saldoPosterior).toBe(-999)
    expect(arg.saldoFinal).toBe(-999)
    expect(cc.lt).toHaveBeenCalled()
  })
  it("statement PDF: ADMIN unscoped", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await getResumen(createGetRequest("http://localhost/api/x?desde=2026-01-01&hasta=2026-01-31"), params())
    expect(cc.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(cc.or).not.toHaveBeenCalled()
  })

  it("receipt: a line of another branch is indistinguishable from not found", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    cc.single.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const { status, body } = await parseResponse(
      await getRecibo(createGetRequest(), paramsMov())
    )
    expect(cc.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},sucursal_id.is.null`)
    expect(status).toBe(404)
    expect(body.error).toBe("Movimiento no encontrado")
  })

  it("receipt: ADMIN unscoped", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    cc.single.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    await getRecibo(createGetRequest(), paramsMov())
    expect(cc.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(cc.or).not.toHaveBeenCalled()
  })
})
