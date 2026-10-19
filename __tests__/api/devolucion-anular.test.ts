import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, mockAuthError, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

const auditUpdate = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: auditUpdate })),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { POST } from "@/app/api/ventas/[id]/devolucion/[devolucionId]/anular/route"

const params = { params: Promise.resolve({ id: "v1", devolucionId: "d1" }) }
const url = "http://localhost/api/ventas/v1/devolucion/d1/anular"

const FILA = {
  id: "d1", venta_id: "v1", numero_devolucion: "NC-000012", motivo: "Ajuste de precio", tipo: "PARCIAL",
  monto_devolucion: "50", monto_aplicado_deuda: "40", modo: "MONTO", motivo_nc: "AJUSTE_PRECIO",
  estado: "COMPLETADA", metodo_reembolso: "EFECTIVO", anulada: true,
  anulada_at: "2026-10-20T15:00:00+00:00", anulada_motivo: "Se cargó por error", items_devolucion: [],
}
const RPC_OK = {
  id: "d1", numero: "NC-000012", ventaId: "v1", anuladaAt: "2026-10-20T15:00:00+00:00",
  montoDevolucion: 50, montoAplicadoDeuda: 40, montoReembolso: 10, metodoReembolso: "EFECTIVO",
  unidadesDescontadas: 0, seriesRestauradas: 0, garantiasReactivadas: 0, cargoCuentaCorriente: 40,
  movimientoCajaId: "mov-9", efectivoSinEgreso: false, replayed: false,
}

let ventas = createChainMock(null)
function setup(venta: Record<string, unknown> | null = { id: "v1" }) {
  ventas = createChainMock(venta)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ventas") return ventas as any
    if (table === "devoluciones_venta") return createChainMock(FILA) as any
    return createChainMock(null) as any
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: RPC_OK, error: null } as any)
}
function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}
const rpcFalla = (message: string, code = "P0001") =>
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message, code } } as any)
const enviar = async (body: unknown = { motivo: "  Se cargó por error  " }) =>
  parseResponse(await POST(createPostRequest(body, url), params))

describe("POST /api/ventas/[id]/devolucion/[devolucionId]/anular", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)
  })
  afterEach(() => {
    vi.mocked(console.error).mockRestore()
  })

  it("llama a la RPC con la venta, la NC, el usuario y el motivo sin espacios", async () => {
    setup()
    const { status } = await enviar()
    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("anular_devolucion_venta", {
      p_org_id: "org-1", p_venta_id: "v1", p_devolucion_id: "d1", p_user_id: "user-1", p_motivo: "Se cargó por error",
    })
    expect(ventas.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("responde lo que hizo la reversa y la NC ya anulada", async () => {
    setup()
    const { body } = await enviar()
    expect(body).toMatchObject({ numero: "NC-000012", efectivoSinEgreso: false, movimientoCajaId: "mov-9", replayed: false })
    expect(body.notaCredito).toMatchObject({ id: "d1", numeroDevolucion: "NC-000012", anulada: true })
  })

  it("audita la anulación de la NC y avisa por webhook nota_credito.anulada", async () => {
    setup()
    await enviar()
    expect(auditUpdate).toHaveBeenCalledWith(
      "notas_credito", "d1", { anulada: false },
      expect.objectContaining({
        anulada: true, numero: "NC-000012", origen: "VENTA", venta_id: "v1", motivo: "Se cargó por error",
        monto: 50, monto_aplicado_deuda: 40, monto_reembolso: 10, metodo_reembolso: "EFECTIVO", ingreso_caja_id: "mov-9",
        efectivo_sin_egreso: false,
      })
    )
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "nota_credito.anulada", {
      id: "d1", numero: "NC-000012", origen: "VENTA", origenId: "v1", motivo: "Se cargó por error",
      monto: 50, montoAplicadoDeuda: 40, montoReembolso: 10, metodoReembolso: "EFECTIVO",
      efectivoSinEgreso: false, anuladaAt: "2026-10-20T15:00:00+00:00",
    })
  })

  it("un reintento (ya estaba anulada) responde 200 sin auditar ni avisar otra vez", async () => {
    setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ...RPC_OK, replayed: true }, error: null } as any)
    const { status, body } = await enviar()
    expect(status).toBe(200)
    expect(body.replayed).toBe(true)
    expect(auditUpdate).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })

  it.each(["VENDEDOR", "TECNICO"])("%s: 403 sin llegar a la RPC", async (role) => {
    mockAuthSuccess({ role })
    setup()
    const { status } = await enviar()
    expect(status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("sin sesión: 401", async () => {
    mockAuthError()
    setup()
    const { status } = await enviar()
    expect(status).toBe(401)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("la venta de otra sucursal (ADMIN con una sucursal elegida): 404 sin llegar a la RPC", async () => {
    mockCookie("suc-2")
    setup(null)
    const { status } = await enviar()
    expect(status).toBe(404)
    expect(ventas.eq).toHaveBeenCalledWith("sucursal_id", "suc-2")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ motivo: "   " }], [{ motivo: "x".repeat(501) }]])("motivo inválido %j: 400 sin llegar a la RPC", async (body) => {
    setup()
    const { status } = await enviar(body)
    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it.each([
    "Solo se puede anular la nota de crédito más reciente de la venta: primero anulá la NC-000013",
    "La venta está anulada: sus notas de crédito ya no se pueden anular",
    "Las devoluciones anteriores a las notas de crédito (DEV-) no se pueden anular",
    'No hay stock de "Funda" en Depósito Casa Central para volver a descontar lo que devolvió la nota de crédito: hay 0, hacen falta 1',
    "La serie IMEI-1 ya no está como la dejó la nota de crédito (se volvió a vender, se reservó o se borró): no se puede anular",
    'La nota de crédito devolvió "Celular" antes de que el sistema guardara qué números de serie volvían: no se puede anular',
  ])("bloqueo de la base → 409 con el mismo texto: %s", async (mensaje) => {
    setup()
    rpcFalla(mensaje)
    const { status, body } = await enviar()
    expect(status).toBe(409)
    expect(body.error).toBe(mensaje)
    expect(auditUpdate).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })

  it("una NC que no es de esta venta → 404", async () => {
    setup()
    rpcFalla("Nota de crédito no encontrada")
    const { status, body } = await enviar()
    expect(status).toBe(404)
    expect(body.error).toBe("Nota de crédito no encontrada")
  })

  it("la venta que desaparece entre el chequeo y la RPC → 404", async () => {
    setup()
    rpcFalla("Venta no encontrada")
    const { status, body } = await enviar()
    expect(status).toBe(404)
    expect(body.error).toBe("Venta no encontrada")
  })

  it("el motivo vacío que llega a la base → 400", async () => {
    setup()
    rpcFalla("El motivo de la anulación es obligatorio")
    const { status, body } = await enviar()
    expect(status).toBe(400)
    expect(body.error).toBe("El motivo de la anulación es obligatorio")
  })

  it("sin la migración 369 → 503", async () => {
    setup()
    rpcFalla("Could not find the function public.anular_devolucion_venta in the schema cache", "PGRST202")
    const { status } = await enviar()
    expect(status).toBe(503)
    expect(console.error).toHaveBeenCalled()
  })

  it("un error al buscar la venta → 500 (no 404) sin llegar a la RPC", async () => {
    setup()
    ventas = createChainMock(null, { message: "connection reset by peer", code: "08006" })
    const { status } = await enviar()
    expect(status).toBe(500)
    expect(console.error).toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it.each([["40P01", "deadlock detected"], ["55P03", "canceling statement due to lock timeout"]])(
    "la base se traba (%s) → 409 con el mensaje de venta ocupada",
    async (code, message) => {
      setup()
      rpcFalla(message, code)
      const { status, body } = await enviar()
      expect(status).toBe(409)
      expect(body.error).toBe("La venta está ocupada en otra operación. Reintentá en unos segundos.")
      expect(auditUpdate).not.toHaveBeenCalled()
      expect(emitWebhookEvent).not.toHaveBeenCalled()
    }
  )

  it("un error que no es de negocio → 500 sin auditar", async () => {
    setup()
    rpcFalla("connection reset by peer", "08006")
    const { status } = await enviar()
    expect(status).toBe(500)
    expect(auditUpdate).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })
})
