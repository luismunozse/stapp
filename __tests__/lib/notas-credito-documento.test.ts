import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock } from "../api/helpers"
import { etiquetaReintegro } from "@/lib/notas-credito/catalogo"
import { cargarDocumentoNC, conAjuste, type LectorNC } from "@/lib/notas-credito/documento"

type Chain = ReturnType<typeof createChainMock>

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

const ORG = {
  nombre: "Taller", nombre_mostrar: "Taller Sol", telefono: "011-4000-0000", direccion: "Av. Siempre Viva 742",
  logo_url: null, moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires", pais: "AR",
  cuit: "30-71234567-8", condicion_iva: "Responsable Inscripto", domicilio_fiscal: null,
  tecnicos_operan_pos: false,
}

const vistaVenta = {
  id: "nc-v", origen: "VENTA", origen_id: "v-1", origen_numero: "42", numero: "NC-000010",
  fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivo_nc: null, detalle: "Producto con falla",
  monto: "1500.00", monto_aplicado_deuda: "500.00", monto_reembolso: "1000.00", metodo: "EFECTIVO",
  cliente_id: null, sucursal_id: "suc-1", organization_id: "org-1", user_id: "user-9", anulada: false,
}

const vistaOrden = {
  ...vistaVenta, id: "nc-o", origen: "ORDEN", origen_id: "o-1", origen_numero: "CEL099", numero: "NC-000011",
  modo: "MONTO", motivo_nc: "TRABAJO_NO_REALIZADO", detalle: "No se cambió la pantalla",
  monto: "2000.00", monto_aplicado_deuda: "0.00", monto_reembolso: "2000.00", metodo: "TRANSFERENCIA",
  cliente_id: "cli-1",
}

interface Tablas {
  vista?: unknown
  ventas?: unknown
  devoluciones_venta?: unknown
  ordenes_servicio?: unknown
  notas_credito?: unknown
  clientes?: unknown
  organizations?: unknown
  sucursalesError?: boolean
  /** La migración 295 no está aplicada: el primer SELECT de organizations falla con 42703. */
  sinColumnasFiscales?: boolean
}

function setup(t: Tablas) {
  const chains: Record<string, Chain> = {}
  const filas: Record<string, unknown> = {
    v_notas_credito: t.vista ?? null,
    ventas: t.ventas ?? null,
    devoluciones_venta: t.devoluciones_venta ?? null,
    ordenes_servicio: t.ordenes_servicio ?? null,
    notas_credito: t.notas_credito ?? null,
    clientes: t.clientes ?? null,
    organizations: t.organizations ?? ORG,
    sucursales: { nombre: "Centro" },
    users: { nombre: "Ana" },
  }
  let llamadasOrg = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((tabla: string) => {
    if (tabla === "organizations") llamadasOrg++
    const chain = tabla === "sucursales" && t.sucursalesError
      ? createChainMock(null, { message: "boom" })
      : tabla === "organizations" && t.sinColumnasFiscales && llamadasOrg === 1
        ? createChainMock(null, { code: "42703", message: "column organizations.cuit does not exist" })
        : tabla === "organizations" && t.sinColumnasFiscales
          ? createChainMock(Object.fromEntries(Object.entries(ORG).filter(([k]) => !["cuit", "condicion_iva", "domicilio_fiscal"].includes(k))))
          : createChainMock(filas[tabla] ?? null)
    chains[tabla] = chain
    return chain as any
  })
  return chains
}

const admin: LectorNC = { organizationId: "org-1", userId: "user-1", role: "ADMIN", userSucursalId: null }
const vendedor: LectorNC = { organizationId: "org-1", userId: "user-1", role: "VENDEDOR", userSucursalId: "suc-1" }
const tecnico: LectorNC = { organizationId: "org-1", userId: "tec-1", role: "TECNICO", userSucursalId: "suc-1" }

const venta = {
  id: "v-1", cliente_nombre: "María (mostrador)", cliente_telefono: "1155550000",
  total: "3000.00", monto_abonado: "1000.00", estado: "COMPLETADA",
  devoluciones_venta: [{ monto_aplicado_deuda: "500.00" }],
}
const devolucion = {
  observaciones: "Caja abierta",
  anulada_at: null,
  anulada_motivo: null,
  items_devolucion: [
    { cantidad: 1, precio_unitario: "1500.00", subtotal: "1500.00", items_venta: { descripcion: "Funda silicona" } },
  ],
}
const orden = {
  id: "o-1", tecnico_id: "tec-1", telefono_contacto: "1166660000",
  costo_final: "10000.00", descuento_cobro: "0", total_cobrado: "4000.00",
  notas_credito: [{ monto_aplicado_deuda: "1000.00", anulada: false }],
}
const ncOrden = {
  anulada_at: null,
  anulada_motivo: null,
  items_nota_credito: [],
}

describe("cargarDocumentoNC — venta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
  })

  it("arma el documento completo de una devolución", async () => {
    setup({ vista: vistaVenta, ventas: venta, devoluciones_venta: devolucion })
    const doc = await cargarDocumentoNC("nc-v", admin)
    expect(doc).toEqual({
      id: "nc-v", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "NC-000010",
      fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivoNc: null, detalle: "Producto con falla",
      observaciones: "Caja abierta",
      items: [{ descripcion: "Funda silicona", cantidad: 1, precioUnitario: 1500, subtotal: 1500 }],
      monto: 1500, montoAplicadoDeuda: 500, montoReembolso: 1000, metodo: "EFECTIVO",
      // 3000 - 1000 cobrado - 500 que ya descontó la NC
      pendienteActual: 1500,
      anulada: false, anuladaAt: null, anuladaMotivo: null,
      cliente: { nombre: "María (mostrador)", dni: null, telefono: "1155550000", email: null, direccion: null },
      sucursalNombre: "Centro", atendidoPor: "Ana",
      emisor: {
        nombreEmpresa: "Taller Sol", telefonoEmpresa: "011-4000-0000", direccionEmpresa: "Av. Siempre Viva 742",
        domicilioFiscalEmpresa: null, cuitEmpresa: "30-71234567-8", condicionIvaEmpresa: "Responsable Inscripto",
        pais: "AR", logoUrl: null, moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires",
      },
    })
  })

  it("lee la vista y las tablas del motor por id Y organización", async () => {
    const chains = setup({ vista: vistaVenta, ventas: venta, devoluciones_venta: devolucion })
    await cargarDocumentoNC("nc-v", admin)
    expect(chains.v_notas_credito.eq).toHaveBeenCalledWith("id", "nc-v")
    expect(chains.v_notas_credito.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains.ventas.eq).toHaveBeenCalledWith("id", "v-1")
    expect(chains.ventas.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains.devoluciones_venta.eq).toHaveBeenCalledWith("id", "nc-v")
    expect(chains.devoluciones_venta.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  // Review Focus 4: id de otra organización o inexistente.
  it("un id que la vista no devuelve para la organización da null sin leer nada más", async () => {
    setup({ vista: null })
    expect(await cargarDocumentoNC("nc-ajena", admin)).toBeNull()
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])).toEqual(["v_notas_credito"])
  })

  // Review Focus 4: mismas reglas que GET /api/ventas/[id].
  it("el vendedor solo ve las NC de sus ventas y de su sucursal", async () => {
    const chains = setup({ vista: vistaVenta, ventas: null })
    expect(await cargarDocumentoNC("nc-v", vendedor)).toBeNull()
    expect(chains.ventas.eq).toHaveBeenCalledWith("vendedor_id", "user-1")
    expect(chains.ventas.eq).toHaveBeenCalledWith("sucursal_id", "suc-1")
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("devoluciones_venta")
  })

  it("el ADMIN con una sucursal elegida no ve las de otra", async () => {
    mockCookie("suc-2")
    const chains = setup({ vista: vistaVenta, ventas: null })
    expect(await cargarDocumentoNC("nc-v", admin)).toBeNull()
    expect(chains.ventas.eq).toHaveBeenCalledWith("sucursal_id", "suc-2")
  })

  it("el técnico sin permiso de POS no ve NC de ventas", async () => {
    setup({ vista: vistaVenta, ventas: venta, devoluciones_venta: devolucion })
    expect(await cargarDocumentoNC("nc-v", tecnico)).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("ventas")
  })

  it("el técnico con permiso de POS ve las NC de sus ventas", async () => {
    setup({ vista: vistaVenta, ventas: venta, devoluciones_venta: devolucion, organizations: { ...ORG, tecnicos_operan_pos: true } })
    expect(await cargarDocumentoNC("nc-v", tecnico)).not.toBeNull()
  })

  it("una venta anulada no tiene pendiente que mostrar", async () => {
    setup({ vista: vistaVenta, ventas: { ...venta, estado: "ANULADA" }, devoluciones_venta: devolucion })
    expect((await cargarDocumentoNC("nc-v", admin))?.pendienteActual).toBeNull()
  })

  it("el saldo pendiente no descuenta lo que bajó una NC anulada", async () => {
    const chains = setup({
      vista: vistaVenta,
      ventas: { ...venta, devoluciones_venta: [{ monto_aplicado_deuda: "500.00", anulada: true }] },
      devoluciones_venta: devolucion,
    })
    const doc = await cargarDocumentoNC("nc-v", admin)
    expect(doc!.pendienteActual).toBe(2000) // 3000 − 1000 cobrado; la NC anulada ya no descuenta
    expect(chains.ventas.select).toHaveBeenCalledWith(
      expect.stringContaining("devoluciones_venta (monto_aplicado_deuda, anulada)")
    )
  })

  it("una NC por productos topeada por una NC anterior suma su total con un renglón de ajuste", async () => {
    // Líneas por $1500 y una NC de $1000: una NC por monto ya había acreditado parte de la venta.
    setup({
      vista: { ...vistaVenta, monto: "1000.00", monto_aplicado_deuda: "0.00", monto_reembolso: "1000.00" },
      ventas: venta,
      devoluciones_venta: devolucion,
    })
    const doc = await cargarDocumentoNC("nc-v", admin)
    expect(doc!.items.reduce((s, i) => s + i.subtotal, 0)).toBe(1000)
    expect(doc!.items.at(-1)).toEqual({
      descripcion: "Ajuste por lo ya acreditado en notas de crédito anteriores",
      cantidad: 1,
      precioUnitario: -500,
      subtotal: -500,
    })
  })

  it("una NC anulada trae cuándo y por qué", async () => {
    setup({
      vista: { ...vistaVenta, anulada: true },
      ventas: venta,
      devoluciones_venta: { ...devolucion, anulada_at: "2026-10-14T12:00:00+00:00", anulada_motivo: "Error de carga" },
    })
    const doc = await cargarDocumentoNC("nc-v", admin)
    expect(doc).toMatchObject({ anulada: true, anuladaAt: "2026-10-14T12:00:00+00:00", anuladaMotivo: "Error de carga" })
  })

  it("si falla el nombre de la sucursal, el documento sale igual", async () => {
    setup({ vista: vistaVenta, ventas: venta, devoluciones_venta: devolucion, sucursalesError: true })
    expect((await cargarDocumentoNC("nc-v", admin))?.sucursalNombre).toBeNull()
  })

  it("sin la migración 295 el documento sale igual, con los datos fiscales vacíos", async () => {
    setup({ vista: vistaVenta, ventas: venta, devoluciones_venta: devolucion, sinColumnasFiscales: true })
    const doc = await cargarDocumentoNC("nc-v", admin)
    expect(doc?.emisor).toMatchObject({ nombreEmpresa: "Taller Sol", cuitEmpresa: null, condicionIvaEmpresa: null, domicilioFiscalEmpresa: null })
  })

  // Un historial sin medio de reintegro: sin medio no se sabe si se pagó, así que el renglón es neutro.
  it("una devolución histórica sin medio no afirma que se devolvió plata", async () => {
    setup({ vista: { ...vistaVenta, metodo: null, monto_aplicado_deuda: "0.00", monto_reembolso: "1500.00" }, ventas: venta, devoluciones_venta: devolucion })
    const doc = await cargarDocumentoNC("nc-v", admin)
    expect(doc?.metodo).toBeNull()
    expect(etiquetaReintegro(doc?.metodo)).toBe("Reintegro")
  })
})

describe("cargarDocumentoNC — orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
  })

  it("arma el documento con el pendiente de la orden y los datos del cliente", async () => {
    const chains = setup({
      vista: vistaOrden, ordenes_servicio: orden, notas_credito: ncOrden,
      clientes: { nombre: "Juan Pérez", dni: "20123456", telefono: "1177770000", email: "juan@example.com", direccion: "Calle 1" },
    })
    const doc = await cargarDocumentoNC("nc-o", admin)
    expect(doc).toMatchObject({
      origen: "ORDEN", origenNumero: "CEL099", modo: "MONTO", motivoNc: "TRABAJO_NO_REALIZADO",
      detalle: "No se cambió la pantalla", observaciones: null, items: [],
      // 10000 - 0 - 4000 cobrado - 1000 que ya bajó una NC
      pendienteActual: 5000,
      // El teléfono de contacto de la orden manda, como en el detalle de la orden.
      cliente: { nombre: "Juan Pérez", dni: "20123456", telefono: "1166660000", email: "juan@example.com", direccion: "Calle 1" },
    })
    expect(chains.ordenes_servicio.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains.notas_credito.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains.clientes.eq).toHaveBeenCalledWith("id", "cli-1")
    expect(chains.clientes.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("trae los ítems con su subtotal", async () => {
    setup({
      vista: vistaOrden, ordenes_servicio: orden, clientes: { nombre: "Juan" },
      notas_credito: { ...ncOrden, items_nota_credito: [{ descripcion: "Pantalla", cantidad: 2, precio_unitario: "1000.50" }] },
    })
    expect((await cargarDocumentoNC("nc-o", admin))?.items).toEqual([
      { descripcion: "Pantalla", cantidad: 2, precioUnitario: 1000.5, subtotal: 2001 },
    ])
  })

  // Review Focus 4: mismas reglas que GET /api/ordenes/[id].
  it("el técnico no ve NC de órdenes de otro técnico", async () => {
    setup({ vista: vistaOrden, ordenes_servicio: { ...orden, tecnico_id: "tec-2" }, notas_credito: ncOrden })
    expect(await cargarDocumentoNC("nc-o", tecnico)).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("notas_credito")
  })

  it("el técnico ve las NC de sus órdenes", async () => {
    setup({ vista: vistaOrden, ordenes_servicio: orden, notas_credito: ncOrden, clientes: { nombre: "Juan" } })
    expect(await cargarDocumentoNC("nc-o", tecnico)).not.toBeNull()
  })

  it("sin costo final no hay pendiente que mostrar", async () => {
    setup({ vista: vistaOrden, ordenes_servicio: { ...orden, costo_final: null }, notas_credito: ncOrden, clientes: { nombre: "Juan" } })
    expect((await cargarDocumentoNC("nc-o", admin))?.pendienteActual).toBeNull()
  })

  it("el pendiente nunca es negativo", async () => {
    setup({
      vista: vistaOrden, ordenes_servicio: { ...orden, total_cobrado: "12000.00" }, notas_credito: ncOrden, clientes: { nombre: "Juan" },
    })
    expect((await cargarDocumentoNC("nc-o", admin))?.pendienteActual).toBe(0)
  })
})

describe("conAjuste — las líneas del documento suman lo que se acreditó", () => {
  const linea = (descripcion: string, cantidad: number, subtotal: number) => ({
    descripcion, cantidad, precioUnitario: subtotal / cantidad, subtotal,
  })

  it("por productos después de una NC por monto: el renglón descuenta lo ya acreditado (probe 19 de la 367)", () => {
    expect(conAjuste([linea("Funda", 9, 90)], 40)).toEqual([
      linea("Funda", 9, 90),
      { descripcion: "Ajuste por lo ya acreditado en notas de crédito anteriores", cantidad: 1, precioUnitario: -50, subtotal: -50 },
    ])
  })

  it("centavos de redondeo: un renglón de redondeo", () => {
    const items = [linea("A", 1, 33.33), linea("B", 1, 33.33), linea("C", 1, 33.33)]
    expect(conAjuste(items, 100).at(-1)).toEqual({
      descripcion: "Ajuste por redondeo", cantidad: 1, precioUnitario: 0.01, subtotal: 0.01,
    })
  })

  it("si las líneas ya suman el total, no agrega nada", () => {
    const items = [linea("Funda", 2, 100)]
    expect(conAjuste(items, 100)).toEqual(items)
  })

  it("una NC por monto (sin líneas) sigue sin líneas", () => {
    expect(conAjuste([], 50)).toEqual([])
  })
})
