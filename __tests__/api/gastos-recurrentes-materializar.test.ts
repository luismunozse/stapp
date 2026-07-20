import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
}))

import { sucursalParaEscritura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST, calcularProximo } from "@/app/api/gastos-recurrentes/materializar/route"

describe("calcularProximo — MENSUAL no saltea meses por overflow de día", () => {
  it("31/01 con día 31 → 28/02 (NO 31/03: febrero no se saltea)", () => {
    expect(calcularProximo("2026-01-31", "MENSUAL", 31)).toBe("2026-02-28")
  })

  it("28/02 con día 31 → 31/03 (recupera el ancla en un mes de 31 días)", () => {
    expect(calcularProximo("2026-02-28", "MENSUAL", 31)).toBe("2026-03-31")
  })

  it("31/05 con día 31 → 30/06 (junio tiene 30, no saltea a julio)", () => {
    expect(calcularProximo("2026-05-31", "MENSUAL", 31)).toBe("2026-06-30")
  })

  it("cruza el año: 31/12 con día 31 → 31/01 del año siguiente", () => {
    expect(calcularProximo("2026-12-31", "MENSUAL", 31)).toBe("2027-01-31")
  })

  it("día del mes normal (15) avanza un mes", () => {
    expect(calcularProximo("2026-01-15", "MENSUAL", 15)).toBe("2026-02-15")
  })

  it("sin dia_del_mes: usa el día de la fecha y no desborda", () => {
    expect(calcularProximo("2026-01-31", "MENSUAL", null)).toBe("2026-02-28")
  })

  it("SEMANAL suma 7 días", () => {
    expect(calcularProximo("2026-01-10", "SEMANAL", null)).toBe("2026-01-17")
  })

  it("ANUAL suma un año", () => {
    expect(calcularProximo("2026-06-15", "ANUAL", null)).toBe("2027-06-15")
  })
})

const mockVencidos = [
  {
    id: "gr-1",
    concepto: "Alquiler",
    monto: 5000,
    metodo_pago: "EFECTIVO",
    categoria_gasto_id: null,
    observaciones: null,
    proximo_vencimiento: "2024-01-01",
    frecuencia: "MENSUAL",
    dia_del_mes: 1,
  },
  {
    id: "gr-2",
    concepto: "Internet",
    monto: 2000,
    metodo_pago: "TRANSFERENCIA",
    categoria_gasto_id: null,
    observaciones: null,
    proximo_vencimiento: "2024-01-01",
    frecuencia: "MENSUAL",
    dia_del_mes: 1,
  },
]

describe("POST /api/gastos-recurrentes/materializar", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST()
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 500 when sucursalParaEscritura returns null", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue(null)

    const response = await POST()
    const { status } = await parseResponse(response)
    expect(status).toBe(500)
  })

  it("calls sucursalParaEscritura exactly once before the loop", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    const vencidosChain = createChainMock(mockVencidos)
    const sesionChain = createChainMock(null)
    const movChain = createChainMock({ id: "mov-1" })
    const updateChain = createChainMock(null)
    updateChain.then = (resolve: any) => resolve({ data: null, error: null })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "gastos_recurrentes") {
        const chain = createChainMock(mockVencidos)
        chain.update = vi.fn().mockReturnValue(updateChain)
        return chain as any
      }
      if (table === "sesiones_caja") return sesionChain as any
      if (table === "movimientos_caja") return movChain as any
      return createChainMock(null) as any
    })

    await POST()

    expect(sucursalParaEscritura).toHaveBeenCalledTimes(1)
  })

  it("stamps sucursal_id on every movimientos_caja INSERT", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    const insertPayloads: any[] = []
    const updateChain = createChainMock(null)
    updateChain.then = (resolve: any) => resolve({ data: null, error: null })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "gastos_recurrentes") {
        const chain = createChainMock(mockVencidos)
        chain.update = vi.fn().mockReturnValue(updateChain)
        return chain as any
      }
      if (table === "sesiones_caja") return createChainMock(null) as any
      if (table === "movimientos_caja") {
        const chain: any = {
          insert: vi.fn().mockImplementation((payload: any) => {
            insertPayloads.push(payload)
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: "mov-x" }, error: null }),
            }
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(insertPayloads.length).toBe(2)
    for (const payload of insertPayloads) {
      expect(payload.sucursal_id).toBe("suc-A")
    }
  })
})
