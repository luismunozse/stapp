// @vitest-environment node
/**
 * POST /api/ordenes y POST /api/cotizaciones solo aceptan clientes y sectores
 * de la organización de la sesión.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
  getNextQuoteNumber: vi.fn().mockResolvedValue(1),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { validarClienteYSector } from "@/lib/referencias-cliente"
import { POST as crearOrden } from "@/app/api/ordenes/route"

describe("validarClienteYSector", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rechaza un cliente que no es de la organización", async () => {
    const clientes = createChainMock(null)
    mockSupabaseFrom({ clientes })

    expect(await validarClienteYSector("org-1", "cli-ajeno")).toBe("Cliente no encontrado")
    expect(clientes.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("rechaza un sector que no es del cliente", async () => {
    const sectores = createChainMock(null)
    mockSupabaseFrom({ clientes: createChainMock({ id: "c1" }), sectores_cliente: sectores })

    expect(await validarClienteYSector("org-1", "c1", "sec-ajeno")).toBe("Sector no válido para este cliente")
    expect(sectores.eq).toHaveBeenCalledWith("cliente_id", "c1")
  })

  it("acepta cliente y sector propios", async () => {
    mockSupabaseFrom({ clientes: createChainMock({ id: "c1" }), sectores_cliente: createChainMock({ id: "s1" }) })

    expect(await validarClienteYSector("org-1", "c1", "s1")).toBeNull()
  })

  it("sin sector no consulta sectores", async () => {
    mockSupabaseFrom({ clientes: createChainMock({ id: "c1" }) })

    expect(await validarClienteYSector("org-1", "c1")).toBeNull()
  })
})

describe("POST /api/ordenes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("400 y no inserta si el cliente es de otra organización", async () => {
    const insert = vi.fn()
    mockSupabaseFrom({
      clientes: createChainMock(null),
      ordenes_servicio: { ...createChainMock(null), insert } as any,
    })

    const res = await crearOrden(
      createPostRequest(
        { clienteId: "cli-ajeno", dispositivo: "iPhone", tipoDispositivo: "CELULAR", problemaReportado: "x" },
        "http://localhost/api/ordenes"
      )
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
})
