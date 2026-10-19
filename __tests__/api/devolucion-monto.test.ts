import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

const auditCreate = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: auditCreate })),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/caja-utils", () => ({
  registrarEgresoCajaEfectivo: vi.fn().mockResolvedValue(undefined),
}))

import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { registrarEgresoCajaEfectivo } from "@/lib/caja-utils"
import { POST } from "@/app/api/ventas/[id]/devolucion/route"

const params = { params: Promise.resolve({ id: "v1" }) }
const url = "http://localhost/api/ventas/v1/devolucion"
const DEV = {
  id: "d1", venta_id: "v1", numero_devolucion: "NC-000012", motivo: "Ajuste de precio", tipo: "PARCIAL",
  monto_devolucion: "50", monto_aplicado_deuda: "40", modo: "MONTO", motivo_nc: "AJUSTE_PRECIO", anulada: false,
  estado: "COMPLETADA", items_devolucion: [],
}
const RPC_OK = {
  id: "d1", numero: "NC-000012", modo: "MONTO", tipo: "PARCIAL", montoDevolucion: 50,
  montoAplicadoDeuda: 40, montoReembolso: 10, movimientoCajaId: "mov-1", replayed: false,
}

let tablas: string[] = []
let ventas = createChainMock(null)
function setup(venta: Record<string, unknown> | null = { cliente_id: "c1" }) {
  tablas = []
  ventas = createChainMock(venta ? { id: "v1", sucursal_id: "suc-1", ...venta } : null, venta ? null : { message: "no rows" })
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    tablas.push(table)
    if (table === "ventas") return ventas as any
    if (table === "devoluciones_venta") return createChainMock(DEV) as any
    return createChainMock(null) as any
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: RPC_OK, error: null } as any)
}

const porMonto = (extra: Record<string, unknown> = {}) => ({
  modo: "MONTO", motivoNc: "AJUSTE_PRECIO", monto: 50, metodoReembolso: "EFECTIVO", idempotencyKey: "k-1", ...extra,
})
const rpcArgs = () => vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>
const enviar = async (body: unknown) => parseResponse(await POST(createPostRequest(body, url), params))

describe("POST /api/ventas/[id]/devolucion — nota de crédito por monto", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    // Sin sucursal elegida (ADMIN ve todas). clearAllMocks no borra una
    // implementación puesta por un test anterior.
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  })

  it("llama a la RPC en modo MONTO, sin productos, con la etiqueta del motivo y el egreso adentro", async () => {
    setup()
    const { status, body } = await enviar(porMonto())

    expect(status).toBe(201)
    expect(rpcArgs()).toEqual({
      p_org_id: "org-1", p_venta_id: "v1", p_user_id: "user-1", p_numero_devolucion: null,
      p_motivo: "Ajuste de precio", p_observaciones: null, p_metodo_reembolso: "EFECTIVO",
      p_reembolso_referencia: null, p_items: [], p_idempotency_key: "k-1",
      p_modo: "MONTO", p_monto: 50, p_motivo_nc: "AJUSTE_PRECIO", p_registrar_egreso: true,
    })
    expect(body).toMatchObject({ id: "d1", numeroDevolucion: "NC-000012", montoAplicadoDeuda: 40, montoReembolso: 10 })
  })

  it("el detalle cargado viaja como motivo y el monto se redondea a centavos", async () => {
    setup()
    await enviar(porMonto({ motivo: "  Le cobramos el cable dos veces ", monto: 33.333 }))
    expect(rpcArgs()).toMatchObject({ p_motivo: "Le cobramos el cable dos veces", p_monto: 33.33 })
  })

  it("la ruta ya no toca la caja: el egreso lo hace la RPC en la misma transacción", async () => {
    setup()
    await enviar(porMonto())
    expect(tablas).not.toContain("movimientos_caja")
    expect(tablas).not.toContain("sesiones_caja")
    expect(registrarEgresoCajaEfectivo).not.toHaveBeenCalled()
  })

  it.each([
    ["sin motivo del catálogo", { motivoNc: undefined }, "El motivo es requerido"],
    ["con un motivo inventado", { motivoNc: "INVENTADO" }, "Motivo de nota de crédito inválido"],
    ["sin monto", { monto: undefined }, "El monto tiene que ser mayor a cero"],
    ["con monto cero", { monto: 0 }, "El monto tiene que ser mayor a cero"],
    ["con medio centavo", { monto: 0.004 }, "El monto tiene que ser mayor a cero"],
    ["con productos", { items: [{ itemVentaId: "iv1", cantidad: 1, precioUnitario: 10, restaurarStock: false }] }, "Una nota de crédito por monto no lleva productos"],
  ])("rechaza un pedido %s sin llamar a la RPC", async (_caso, extra, mensaje) => {
    setup()
    const { status, body } = await enviar(porMonto(extra))
    expect(status).toBe(400)
    expect(body.error).toBe(mensaje)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("un pedido de un cliente anterior (sin modo ni motivo del catálogo) sigue siendo una devolución de productos", async () => {
    setup()
    const { status } = await enviar({
      motivo: "Defectuoso",
      items: [{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 2, precioUnitario: 10, restaurarStock: true }],
    })
    expect(status).toBe(201)
    expect(rpcArgs()).toMatchObject({
      p_modo: "ITEMS", p_motivo: "Defectuoso", p_motivo_nc: null, p_monto: null, p_registrar_egreso: true,
      p_items: [{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 2, restaurarStock: true }],
    })
  })

  it("por productos con motivo del catálogo y sin detalle, la etiqueta va como motivo", async () => {
    setup()
    await enviar({
      modo: "ITEMS", motivoNc: "GARANTIA",
      items: [{ itemVentaId: "iv1", cantidad: 1, precioUnitario: 10, restaurarStock: false }],
    })
    expect(rpcArgs()).toMatchObject({ p_modo: "ITEMS", p_motivo: "Garantía", p_motivo_nc: "GARANTIA" })
  })

  it.each([
    ["El monto supera lo disponible para acreditar. Máximo: 66.67", 409],
    ["La venta ya no tiene saldo para acreditar", 409],
    ["La clave de reintento ya se uso en una nota de credito de otra venta", 409],
    ["Venta no encontrada", 404],
    ["Falta el medio de reintegro", 400],
    ["El motivo de la nota de crédito es obligatorio", 400],
    ["El monto de la nota de crédito tiene que ser mayor a cero", 400],
    ["Elegí al menos un producto para devolver", 400],
  ])("traduce '%s' de la RPC a %i con el mismo texto", async (mensaje, status) => {
    setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { code: "P0001", message: mensaje } } as any)
    const res = await enviar(porMonto())
    expect(res.status).toBe(status)
    expect(res.body.error).toBe(mensaje)
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("audita como nota de crédito y avisa por los dos webhooks", async () => {
    setup()
    await enviar(porMonto())

    expect(auditCreate).toHaveBeenCalledWith("notas_credito", "d1", {
      origen: "VENTA", numero: "NC-000012", venta_id: "v1", modo: "MONTO", motivo_nc: "AJUSTE_PRECIO",
      tipo: "PARCIAL", monto: 50, monto_aplicado_deuda: 40, monto_reembolso: 10,
      metodo_reembolso: "EFECTIVO", items_count: 0, egreso_caja_id: "mov-1",
    })
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "nota_credito.creada", {
      id: "d1", numero: "NC-000012", origen: "VENTA", origenId: "v1", modo: "MONTO", motivoNc: "AJUSTE_PRECIO",
      monto: 50, montoAplicadoDeuda: 40, montoReembolso: 10, metodoReembolso: "EFECTIVO",
    })
    // El evento de siempre se sigue emitiendo (spec), ahora con el modo
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "venta.devolucion", expect.objectContaining({
      id: "d1", ventaId: "v1", numeroDevolucion: "NC-000012", modo: "MONTO", montoDevolucion: 50,
    }))
  })

  it("sin reintegro (todo bajó la deuda) no registra medio de reintegro en la auditoría ni en los webhooks", async () => {
    setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ...RPC_OK, montoAplicadoDeuda: 50, montoReembolso: 0, movimientoCajaId: null }, error: null,
    } as any)
    await enviar(porMonto())

    expect(auditCreate).toHaveBeenCalledWith("notas_credito", "d1", expect.objectContaining({
      metodo_reembolso: null, monto_reembolso: 0, egreso_caja_id: null,
    }))
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "nota_credito.creada", expect.objectContaining({ metodoReembolso: null }))
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "venta.devolucion", expect.objectContaining({ metodoReembolso: null }))
  })

  it("un reintento (replayed) responde 200 sin auditar de nuevo", async () => {
    setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ...RPC_OK, replayed: true }, error: null } as any)
    const { status } = await enviar(porMonto())
    expect(status).toBe(200)
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("un VENDEDOR no emite (403) y no llega a la RPC", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    setup()
    const { status } = await enviar(porMonto())
    expect(status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("cuenta corriente sin cliente: 400 antes de la RPC", async () => {
    setup({ cliente_id: null })
    const { status, body } = await enviar(porMonto({ metodoReembolso: "CUENTA_CORRIENTE" }))
    expect(status).toBe(400)
    expect(body.error).toMatch(/cliente/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("un ADMIN con otra sucursal elegida no emite sobre una venta ajena (404)", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn((n: string) => (n === "stapp-sucursal-activa" ? { value: "suc-a" } : undefined)),
      set: vi.fn(),
    } as any)
    setup(null)
    const { status } = await enviar(porMonto())
    expect(status).toBe(404)
    expect(ventas.eq).toHaveBeenCalledWith("sucursal_id", "suc-a")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
