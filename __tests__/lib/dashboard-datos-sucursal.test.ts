import { describe, it, expect, beforeEach } from "vitest"
import { consultarDatosDashboard } from "@/lib/dashboard/datos"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"

const S1 = "sucursal-1"
const U1 = "user-1"

function montar() {
  const chains = {
    ordenes_servicio: createChainMock([]),
    facturas: createChainMock([]),
    garantias: createChainMock([]),
    cobros_orden: createChainMock([]),
    ventas: createChainMock([]),
    clientes: createChainMock([]),
    inventario: createChainMock([]),
    garantias_venta: createChainMock([]),
  }
  mockSupabaseFrom(chains)
  return chains
}

describe("consultarDatosDashboard order scope", () => {
  let chains: ReturnType<typeof montar>
  beforeEach(() => {
    chains = montar()
  })

  it("adds no branch filter for the unfiltered scope", async () => {
    await consultarDatosDashboard("org-1", { tipo: "todas" })
    for (const c of Object.values(chains)) {
      expect(c.or).not.toHaveBeenCalled()
    }
    expect(chains.ordenes_servicio.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(chains.facturas.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
    expect(chains.cobros_orden.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })

  it("scopes orders, invoices, warranties and collections to the branch", async () => {
    await consultarDatosDashboard("org-1", { tipo: "sucursal", sucursalId: S1 })
    expect(chains.ordenes_servicio.eq).toHaveBeenCalledWith("sucursal_id", S1)
    expect(chains.facturas.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
    expect(chains.garantias.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
    expect(chains.cobros_orden.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
    // Sales and customers are not order data.
    expect(chains.ventas.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(chains.clientes.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })

  it("scopes a technician to branch or assigned orders", async () => {
    await consultarDatosDashboard("org-1", {
      tipo: "sucursal_o_asignadas",
      sucursalId: S1,
      userId: U1,
    })
    const filtro = `sucursal_id.eq.${S1},tecnico_id.eq.${U1}`
    expect(chains.ordenes_servicio.or).toHaveBeenCalledWith(filtro, undefined)
    expect(chains.facturas.or).toHaveBeenCalledWith(filtro, { referencedTable: "ordenes_servicio" })
    expect(chains.cobros_orden.or).toHaveBeenCalledWith(filtro, { referencedTable: "ordenes_servicio" })
  })

  it("embeds the order on cobros_orden only when a scope applies", async () => {
    await consultarDatosDashboard("org-1", { tipo: "todas" })
    const selectsTodas = chains.cobros_orden.select.mock.calls.map((c) => String(c[0]))
    expect(selectsTodas.some((s) => s.includes("ordenes_servicio"))).toBe(false)

    chains.cobros_orden.select.mockClear()
    await consultarDatosDashboard("org-1", { tipo: "sucursal", sucursalId: S1 })
    const selectsSuc = chains.cobros_orden.select.mock.calls.map((c) => String(c[0]))
    expect(selectsSuc.every((s) => s.includes("ordenes_servicio!inner"))).toBe(true)
  })
})
