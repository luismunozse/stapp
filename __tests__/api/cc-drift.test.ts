import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  agruparPorOrganizacion,
  mensajeDrift,
  leerDrift,
  type FilaDrift,
} from "@/lib/cuenta-corriente-drift"
import { mockSupabaseFrom, createChainMock } from "./helpers"

function fila(over: Partial<FilaDrift> = {}): FilaDrift {
  return {
    tipo_drift: "SALDO_DESCUADRADO",
    organization_id: "org-1",
    cliente_id: "cli-1",
    cliente_nombre: "Juan Pérez",
    referencia_tipo: null,
    referencia_id: null,
    valor_documento: 0,
    valor_ledger: 0,
    diferencia: 0,
    ...over,
  }
}

/**
 * Auditoría contable, punto 1.7.
 *
 * La vista v_cc_drift existía desde la migración 245 y no la consultaba
 * nadie: ni cron, ni pantalla, ni alerta. Un cliente podía deber $40.000
 * mientras el sistema decía $15.000 y el taller se enteraba por el reclamo.
 */
describe("leerDrift", () => {
  beforeEach(() => vi.clearAllMocks())

  it("normaliza los montos a número", async () => {
    mockSupabaseFrom({
      v_cc_drift: createChainMock([
        {
          tipo_drift: "SALDO_DESCUADRADO",
          organization_id: "org-1",
          cliente_id: "cli-1",
          cliente_nombre: "Juan",
          valor_documento: "1500.50",
          valor_ledger: "1000.00",
          diferencia: "500.50",
        },
      ]),
    })

    const { filas, vistaAusente } = await leerDrift()

    expect(vistaAusente).toBe(false)
    expect(filas[0].diferencia).toBe(500.5)
    expect(filas[0].valor_documento).toBe(1500.5)
  })

  it("si la vista no está creada avisa en vez de romper el cron", async () => {
    // La migración 245 se aplica a mano en el editor de Supabase, así que
    // puede no estar. Un detector no instalado no puede tumbar el cron de
    // todos los talleres.
    mockSupabaseFrom({
      v_cc_drift: createChainMock(null, {
        message: 'relation "v_cc_drift" does not exist',
      }),
    })

    const { filas, vistaAusente } = await leerDrift()

    expect(vistaAusente).toBe(true)
    expect(filas).toEqual([])
  })

  it("un error real de la base sí se propaga", async () => {
    mockSupabaseFrom({
      v_cc_drift: createChainMock(null, { message: "connection reset" }),
    })

    await expect(leerDrift()).rejects.toThrow("connection reset")
  })

  it("acota por organización cuando se pide", async () => {
    const chain = createChainMock([])
    mockSupabaseFrom({ v_cc_drift: chain })

    await leerDrift("org-7")

    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-7")
  })
})

describe("agruparPorOrganizacion", () => {
  it("junta las filas por taller y suma cuánta plata está en duda", () => {
    const porOrg = agruparPorOrganizacion([
      fila({ organization_id: "org-1", diferencia: 500, cliente_nombre: "Juan" }),
      fila({ organization_id: "org-1", diferencia: -300, cliente_nombre: "Ana" }),
      fila({ organization_id: "org-2", diferencia: 100, cliente_nombre: "Luis" }),
    ])

    expect(porOrg.size).toBe(2)
    const org1 = porOrg.get("org-1")!
    expect(org1.cantidad).toBe(2)
    // Valor absoluto: un descuadre de -300 es plata en duda igual que uno de +300.
    expect(org1.montoEnDuda).toBe(800)
    expect(org1.clientesAfectados).toEqual(["Juan", "Ana"])
  })

  it("no repite el mismo cliente con varios descuadres", () => {
    const porOrg = agruparPorOrganizacion([
      fila({ diferencia: 100, cliente_nombre: "Juan" }),
      fila({ diferencia: 200, cliente_nombre: "Juan", tipo_drift: "VENTA_PENDIENTE_SIN_CARGO" }),
    ])

    const org = porOrg.get("org-1")!
    expect(org.clientesAfectados).toEqual(["Juan"])
    expect(org.cantidad).toBe(2)
    expect(org.porTipo).toEqual({ SALDO_DESCUADRADO: 1, VENTA_PENDIENTE_SIN_CARGO: 1 })
  })

  it("sin filas no devuelve talleres", () => {
    expect(agruparPorOrganizacion([]).size).toBe(0)
  })
})

describe("mensajeDrift", () => {
  it("nombra a los clientes y dice cuánta plata está en juego", () => {
    const porOrg = agruparPorOrganizacion([
      fila({ diferencia: 500, cliente_nombre: "Juan Pérez" }),
    ])

    const texto = mensajeDrift(porOrg.get("org-1")!)

    expect(texto).toContain("Juan Pérez")
    expect(texto).toContain("500")
    // Sin tecnicismos: el dueño del taller no sabe qué es un ledger.
    expect(texto.toLowerCase()).not.toContain("ledger")
    expect(texto.toLowerCase()).not.toContain("drift")
  })

  it("con muchos clientes muestra los primeros y cuenta el resto", () => {
    const porOrg = agruparPorOrganizacion([
      fila({ diferencia: 1, cliente_nombre: "A" }),
      fila({ diferencia: 1, cliente_nombre: "B" }),
      fila({ diferencia: 1, cliente_nombre: "C" }),
      fila({ diferencia: 1, cliente_nombre: "D" }),
      fila({ diferencia: 1, cliente_nombre: "E" }),
    ])

    const texto = mensajeDrift(porOrg.get("org-1")!)

    expect(texto).toContain("A, B, C")
    expect(texto).toContain("2 más")
  })

  it("sin nombre de cliente igual dice cuántos movimientos hay", () => {
    const porOrg = agruparPorOrganizacion([
      fila({ diferencia: 100, cliente_nombre: null }),
    ])

    expect(mensajeDrift(porOrg.get("org-1")!)).toContain("1 cliente(s)")
  })
})
