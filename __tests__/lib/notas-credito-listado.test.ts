import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock } from "../api/helpers"
import {
  parseFiltrosListadoNC,
  leerFilasNC,
  zonaHorariaDeOrganizacion,
  type FilaVistaNC,
} from "@/lib/notas-credito/listado"

const sp = (q: string) => new URLSearchParams(q)

describe("parseFiltrosListadoNC", () => {
  it("sin parámetros: página 1, 20 por página, sin filtros", () => {
    expect(parseFiltrosListadoNC(sp(""))).toEqual({
      page: 1, limit: 20, desde: null, hasta: null, origen: null, modo: null,
      motivo: null, estado: null, clienteId: null, q: null,
    })
  })

  it("acota page y limit (máximo 100)", () => {
    expect(parseFiltrosListadoNC(sp("page=0&limit=500"))).toMatchObject({ page: 1, limit: 100 })
    expect(parseFiltrosListadoNC(sp("page=-3&limit=0"))).toMatchObject({ page: 1, limit: 1 })
    expect(parseFiltrosListadoNC(sp("page=abc&limit=xyz"))).toMatchObject({ page: 1, limit: 20 })
  })

  it("toma los filtros válidos", () => {
    expect(
      parseFiltrosListadoNC(
        sp("desde=2026-10-01&hasta=2026-10-13&origen=ORDEN&modo=MONTO&motivo=GARANTIA&estado=ANULADA&cliente=cli-1&q=NC-0001")
      )
    ).toMatchObject({
      desde: "2026-10-01", hasta: "2026-10-13", origen: "ORDEN", modo: "MONTO",
      motivo: "GARANTIA", estado: "ANULADA", clienteId: "cli-1", q: "NC-0001",
    })
  })

  it("ignora valores fuera de catálogo o con formato inválido (no rompe el listado)", () => {
    expect(
      parseFiltrosListadoNC(sp("desde=13/10/2026&origen=FACTURA&modo=x&motivo=CUALQUIERA&estado=BORRADA"))
    ).toMatchObject({ desde: null, origen: null, modo: null, motivo: null, estado: null })
  })

  it("la búsqueda deja solo letras, dígitos y guiones", () => {
    expect(parseFiltrosListadoNC(sp("q=%25NC-0001%2C)")).q).toBe("NC-0001")
    expect(parseFiltrosListadoNC(sp("q=%25%2C")).q).toBeNull()
  })
})

const fila = (extra: Partial<FilaVistaNC>): FilaVistaNC => ({
  id: "nc-1",
  origen: "VENTA",
  origen_id: "v-1",
  origen_numero: "42",
  numero: "NC-000001",
  fecha: "2026-10-13T15:00:00+00:00",
  modo: "ITEMS",
  motivo_nc: null,
  detalle: "Producto con falla",
  monto: "1500.00",
  monto_aplicado_deuda: "500.00",
  monto_reembolso: "1000.00",
  metodo: "EFECTIVO",
  cliente_id: "cli-1",
  sucursal_id: "suc-1",
  organization_id: "org-1",
  user_id: "user-1",
  anulada: false,
  ...extra,
})

function mockTablas(tablas: Record<string, unknown[]>) {
  const chains: Record<string, ReturnType<typeof createChainMock>> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    chains[t] = createChainMock(tablas[t] ?? [])
    return chains[t] as any
  })
  return chains
}

describe("leerFilasNC", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin filas no consulta nada", async () => {
    expect(await leerFilasNC([], "org-1")).toEqual([])
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("arma la fila con números, etiquetas y nombres", async () => {
    mockTablas({
      clientes: [{ id: "cli-1", nombre: "Juan Pérez" }],
      sucursales: [{ id: "suc-1", nombre: "Centro" }],
      users: [{ id: "user-1", nombre: "Ana" }],
    })
    const [f] = await leerFilasNC([fila({})], "org-1")
    expect(f).toEqual({
      id: "nc-1", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "NC-000001",
      fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivoNc: null, motivo: "Producto con falla",
      detalle: "Producto con falla", monto: 1500, montoAplicadoDeuda: 500, montoReembolso: 1000,
      metodo: "EFECTIVO", metodoLabel: "Efectivo", clienteId: "cli-1", clienteNombre: "Juan Pérez",
      sucursalId: "suc-1", sucursalNombre: "Centro", usuarioNombre: "Ana", anulada: false,
    })
  })

  it("todas las lecturas de nombres van por id Y organización", async () => {
    const chains = mockTablas({ clientes: [], sucursales: [], users: [] })
    await leerFilasNC([fila({})], "org-1")
    for (const t of ["clientes", "sucursales", "users"]) {
      expect(chains[t].in).toHaveBeenCalledWith("id", expect.any(Array))
      expect(chains[t].eq).toHaveBeenCalledWith("organization_id", "org-1")
    }
  })

  // Review Focus 2: venta de mostrador sin cliente_id.
  it("una venta sin cliente toma el nombre cargado en la venta, o 'Consumidor final'", async () => {
    const chains = mockTablas({ ventas: [{ id: "v-1", cliente_nombre: "María (mostrador)" }, { id: "v-2", cliente_nombre: null }] })
    const filas = await leerFilasNC(
      [fila({ cliente_id: null }), fila({ id: "nc-2", origen_id: "v-2", cliente_id: null })],
      "org-1"
    )
    expect(filas.map((f) => f.clienteNombre)).toEqual(["María (mostrador)", "Consumidor final"])
    expect(chains.ventas.in).toHaveBeenCalledWith("id", ["v-1", "v-2"])
    expect(chains.ventas.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("una orden muestra su código y no consulta ventas", async () => {
    mockTablas({ clientes: [{ id: "cli-1", nombre: "Juan" }] })
    const [f] = await leerFilasNC([fila({ origen: "ORDEN", origen_id: "o-1", origen_numero: "CEL099", modo: "MONTO", motivo_nc: "TRABAJO_NO_REALIZADO" })], "org-1")
    expect(f.origenNumero).toBe("CEL099")
    expect(f.motivoNc).toBe("TRABAJO_NO_REALIZADO")
    expect(f.motivo).toBe("Trabajo no realizado")
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])).not.toContain("ventas")
  })

  // Review Focus 1: historial DEV- con medio viejo.
  it("el historial DEV- con CREDITO_TIENDA muestra un medio legible", async () => {
    mockTablas({})
    const [f] = await leerFilasNC([fila({ numero: "DEV-0042", metodo: "CREDITO_TIENDA", cliente_id: null, sucursal_id: null, user_id: null })], "org-1")
    expect(f.metodoLabel).toBe("Crédito en el local")
    expect(f.sucursalNombre).toBeNull()
    expect(f.usuarioNombre).toBeNull()
  })

  it("un error en una lectura de nombres se propaga (no inventa nombres)", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((t: string) =>
      (t === "clientes" ? createChainMock(null, { message: "boom" }) : createChainMock([])) as any
    )
    await expect(leerFilasNC([fila({})], "org-1")).rejects.toMatchObject({ message: "boom" })
  })
})

describe("zonaHorariaDeOrganizacion", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lee la zona de la organización", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(createChainMock({ zona_horaria: "Europe/Madrid" }) as any)
    expect(await zonaHorariaDeOrganizacion("org-1")).toBe("Europe/Madrid")
  })

  it("si la lectura falla usa la de Argentina (una zona nunca tumba el listado)", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => { throw new Error("boom") })
    expect(await zonaHorariaDeOrganizacion("org-1")).toBe("America/Argentina/Buenos_Aires")
  })
})
