import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/public-token", () => ({ getOrderByPublicToken: vi.fn() }))

import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { GET } from "@/app/api/public/ordenes/[token]/route"

const ordenBase = {
  id: "o1",
  organization_id: "org-1",
  numero_orden: 7,
  codigo_orden: "IPH007",
  dispositivo: "11 Pro",
  tipo_dispositivo: "CELULAR",
  estado: "REPARADO",
  presupuesto: 187000,
  costo_final: 187000,
  descuento_cobro: 0,
  total_cobrado: 87000,
  notas_credito: [],
  public_token: "tok",
  clientes: { nombre: "Elias" },
  organizations: { nombre: "Taller", moneda: "ARS", cbu_alias: "taller.mp", medios_pago_texto: null },
}

function setup(orden: any, avisos: { data: any; error: any } = { data: [], error: null }) {
  vi.mocked(getOrderByPublicToken).mockResolvedValue({ orden: { ...ordenBase, ...orden }, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((tabla: string) => {
    if (tabla === "cotizaciones") return createChainMock([]) as any
    if (tabla === "pagos_informados") return createChainMock(avisos.data, avisos.error) as any
    return createChainMock(null, { message: `sin mock: ${tabla}` }) as any
  })
}

const get = () => GET(new Request("http://localhost/api/public/ordenes/tok"), { params: Promise.resolve({ token: "tok" }) })

describe("GET /api/public/ordenes/[token] — pago desde el seguimiento", () => {
  beforeEach(() => vi.clearAllMocks())

  it("orden reparada con saldo: muestra total, pagado, saldo y alias", async () => {
    setup({})
    const { status, body } = await parseResponse(await get())
    expect(status).toBe(200)
    expect(body.pago).toMatchObject({ total: 187000, pagado: 87000, saldo: 100000, alias: "taller.mp", avisoPendiente: null })
  })

  it("con un aviso pendiente lo informa", async () => {
    setup({}, { data: [{ monto: "50000", metodo: "TRANSFERENCIA", estado: "PENDIENTE", created_at: "2026-11-19T12:00:00Z" }], error: null })
    const { body } = await parseResponse(await get())
    expect(body.pago.avisoPendiente).toMatchObject({ monto: 50000, metodo: "TRANSFERENCIA" })
  })

  it("con el último aviso rechazado muestra el motivo", async () => {
    setup({}, { data: [{ monto: "50000", metodo: "TRANSFERENCIA", estado: "RECHAZADO", motivo_rechazo: "No llegó", resuelto_at: "2026-11-19T13:00:00Z" }], error: null })
    const { body } = await parseResponse(await get())
    expect(body.pago.ultimoRechazo).toMatchObject({ monto: 50000, motivo: "No llegó" })
  })

  it("sin saldo o sin estar reparada no ofrece pagar", async () => {
    setup({ total_cobrado: 187000 })
    expect((await parseResponse(await get())).body.pago).toBeNull()
    setup({ estado: "EN_REPARACION" })
    expect((await parseResponse(await get())).body.pago).toBeNull()
  })

  it("si la tabla de avisos no responde (migración sin aplicar) no ofrece pagar", async () => {
    setup({}, { data: null, error: { message: "relation pagos_informados does not exist" } })
    const { status, body } = await parseResponse(await get())
    expect(status).toBe(200)
    expect(body.pago).toBeNull()
  })
})
