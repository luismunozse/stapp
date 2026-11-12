/**
 * Deuda de clientes y técnicos (decisión del dueño, 2026-11-12): un TECNICO no ve cuánto
 * debe un cliente salvo que la organización active `tecnicos_ven_deuda_clientes`.
 *
 *  - Lista de clientes: sin columna de deuda, sin total, sin filtro ni orden por deuda.
 *  - Detalle: un saldo negativo (fiado) se informa como 0; el saldo a favor sigue visible
 *    (lo usan los cobros con cuenta corriente).
 *  - Endpoints que solo sirven para ver deuda: 403 (órdenes pendientes, estado de cuenta, recibo).
 *  - ADMIN y VENDEDOR no cambian.
 */
import { describe, it, expect, vi } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/cuenta-corriente-react-pdf", () => ({
  generateResumenCCPDF: vi.fn(async () => Buffer.from("pdf")),
  generateReciboCCPDF: vi.fn(async () => Buffer.from("pdf")),
}))

import { GET as getLista } from "@/app/api/clientes/route"
import { GET as getCliente } from "@/app/api/clientes/[id]/route"
import { GET as getPendientes } from "@/app/api/clientes/[id]/ordenes-pendientes/route"
import { GET as getResumen } from "@/app/api/clientes/[id]/cuenta-corriente/resumen/route"
import { GET as getRecibo } from "@/app/api/clientes/[id]/cuenta-corriente/[movimientoId]/recibo/route"

const params = () => ({ params: Promise.resolve({ id: "cli-1" }) })
const paramsMov = () => ({ params: Promise.resolve({ id: "cli-1", movimientoId: "mov-1" }) })

const FILA = { id: "cli-1", nombre: "Ana", saldo_cuenta: "-300", deuda_pendiente: "1500", ordenes_count: 2 }

function montar(permiso: boolean) {
  const vista = createChainMock([FILA])
  const clientes = createChainMock({ ...FILA, ordenes_servicio: [], sectores_cliente: [] })
  const cc = createChainMock([])
  mockSupabaseFrom({
    v_clientes_resumen: vista,
    clientes,
    cuenta_corriente: cc,
    organizations: createChainMock({ tecnicos_ven_deuda_clientes: permiso, nombre: "Org", zona_horaria: "UTC" }),
  })
  return { vista, cc }
}

const lista = (qs = "") => getLista(createGetRequest(`http://localhost/api/clientes${qs}`))

describe("lista de clientes", () => {
  it("TECNICO sin permiso: sin deuda, sin total y el filtro/orden por deuda se ignoran", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    const { vista } = montar(false)
    const { status, body } = await parseResponse(await lista("?conDeuda=true&sortBy=deudaPendiente"))
    expect(status).toBe(200)
    expect(body.data[0].deudaPendiente).toBeNull()
    expect(body.data[0].saldoCuenta).toBe(0)
    expect(body.totalDeuda).toBeNull()
    expect(body.deudaOculta).toBe(true)
    expect(vista.gt).not.toHaveBeenCalledWith("deuda_pendiente", 0)
    expect(vista.order).not.toHaveBeenCalledWith("deuda_pendiente", expect.anything())
  })

  it("TECNICO con permiso: ve la deuda igual que un vendedor", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    const { vista } = montar(true)
    const { body } = await parseResponse(await lista("?conDeuda=true"))
    expect(body.data[0].deudaPendiente).toBe(1500)
    expect(body.deudaOculta).toBe(false)
    expect(vista.gt).toHaveBeenCalledWith("deuda_pendiente", 0)
  })

  it.each(["ADMIN", "VENDEDOR"])("%s ve la deuda sin depender del permiso", async (role) => {
    mockAuthSuccess({ role, sucursalId: role === "VENDEDOR" ? "s1" : null })
    montar(false)
    const { body } = await parseResponse(await lista())
    expect(body.data[0].deudaPendiente).toBe(1500)
    expect(body.data[0].saldoCuenta).toBe(-300)
  })
})

describe("detalle del cliente", () => {
  it("TECNICO sin permiso: el fiado no aparece (saldo 0) y se marca deudaOculta", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    montar(false)
    const { body } = await parseResponse(await getCliente(createGetRequest(), params()))
    expect(body.saldoCuenta).toBe(0)
    expect(body.deudaOculta).toBe(true)
  })

  it("TECNICO con permiso: ve el saldo real", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    montar(true)
    const { body } = await parseResponse(await getCliente(createGetRequest(), params()))
    expect(body.saldoCuenta).toBe(-300)
    expect(body.deudaOculta).toBe(false)
  })
})

describe("endpoints que solo muestran deuda", () => {
  const llamadas = [
    ["órdenes pendientes", () => getPendientes(createGetRequest(), params())],
    ["estado de cuenta", () => getResumen(createGetRequest("http://localhost/api/x?desde=2026-01-01&hasta=2026-01-31"), params())],
    ["recibo", () => getRecibo(createGetRequest(), paramsMov())],
  ] as const

  it.each(llamadas)("%s: 403 para un TECNICO sin permiso, sin leer movimientos", async (_n, llamar) => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    const { cc } = montar(false)
    const { status, body } = await parseResponse(await llamar())
    expect(status).toBe(403)
    expect(body.code).toBe("DEUDA_NO_PERMITIDA")
    expect(cc.select).not.toHaveBeenCalled()
  })

  it.each(llamadas)("%s: un TECNICO con permiso pasa el control", async (_n, llamar) => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    montar(true)
    // El estado de cuenta responde un PDF: solo importa el status.
    const res = await llamar()
    expect(res.status).not.toBe(403)
  })
})
