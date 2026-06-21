import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST as movimientosPOST } from "@/app/api/caja/movimientos/route"
import { POST as materializarPOST } from "@/app/api/gastos-recurrentes/materializar/route"

// The open cash session must be looked up scoped to the same branch the
// movement is stamped with. Otherwise, with two branches both having an open
// session, the movement could link to another branch's session and corrupt
// its arqueo.

describe("POST /api/caja/movimientos — sesion abierta scoped por sucursal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("busca la sesion abierta filtrando por la sucursal del movimiento", async () => {
    // ADMIN sin cookie => sucursalParaEscritura cae a la sucursal principal "suc-p".
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })

    const sesionChain = createChainMock(null, null) // no hay sesión abierta

    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }, null), // getPrincipalId
      sesiones_caja: sesionChain,
      movimientos_caja: createChainMock({ id: "mov-1" }, null),
    })

    const response = await movimientosPOST(
      createPostRequest(
        { tipo: "INGRESO", monto: 1500, metodoPago: "EFECTIVO", concepto: "Aporte" },
        "http://localhost:3000/api/caja/movimientos"
      )
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(sesionChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-p")
  })
})

describe("POST /api/gastos-recurrentes/materializar — sesion abierta scoped por sucursal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("busca la sesion abierta filtrando por la sucursal de los movimientos", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })

    const sesionChain = createChainMock(null, null) // no hay sesión abierta
    const vencido = {
      id: "g1",
      monto: 100,
      metodo_pago: "EFECTIVO",
      concepto: "Alquiler",
      proximo_vencimiento: "2020-01-01",
      frecuencia: "MENSUAL",
      dia_del_mes: null,
      categoria_gasto_id: null,
      observaciones: null,
    }

    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }, null), // getPrincipalId
      gastos_recurrentes: createChainMock([vencido], null),
      sesiones_caja: sesionChain,
      movimientos_caja: createChainMock({ id: "mov-1" }, null),
    })

    const response = await materializarPOST()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(sesionChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-p")
  })
})
