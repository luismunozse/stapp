/**
 * Task D2 — data layer del expediente.
 *
 * Fija el contrato de `OrdenPDFData` que consumen las Tasks D3/D4 (dibujo de
 * las hojas RECEPCIÓN/ENTREGA): cuando las tablas nuevas (sucursales, users
 * vía tecnico_id/recibido_por, repuestos_orden, garantias, cobros_orden,
 * orden_tiempos_estado) tienen filas, `pdfData` debe llegar con los campos
 * mapeados; cuando no las tienen, deben quedar en null/undefined en vez de
 * romper la generación del PDF.
 *
 * No testea el dibujo (generateOrdenPDF va mockeado, igual que en
 * ordenes-recepcion-null.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
} from "./helpers"

vi.mock("@/lib/pdf", () => ({
  generateOrdenPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))
vi.mock("@/lib/terminologia-server", () => ({
  getTerminologia: vi.fn().mockResolvedValue(null),
}))

import { GET as GET_PDF } from "@/app/api/ordenes/[id]/pdf/route"
import { GET as GET_PUBLIC_PDF } from "@/app/api/public/ordenes/[token]/pdf/route"
import { generateOrdenPDF } from "@/lib/pdf"

const ordenCompleta = {
  id: "ord-1",
  numero_orden: 1,
  codigo_orden: "CEL001",
  organization_id: "org-1",
  cliente_id: "cli-1",
  dispositivo: "iPhone 13",
  tipo_dispositivo: "CELULAR",
  tipo_dispositivo_id: "tipo-1",
  problema_reportado: "No enciende",
  fecha_ingreso: "2026-01-01T00:00:00.000Z",
  estado: "REPARADO",
  public_token: "tok-1",
  sucursal_id: "suc-1",
  tecnico_id: "user-tec-1",
  recibido_por: "user-rec-1",
  diagnostico: "Pantalla rota, se reemplaza módulo",
  costo_final: 50000,
  total_cobrado: 20000,
  estado_cobro: "PARCIAL",
  descuento_cobro: 1000,
  motivo_sin_cobro: null,
  telefono_contacto: "1122334455",
  metadata: { capacidad: "128GB", legado: "valor-sin-config" },
  es_reingreso: true,
  orden_origen_id: "ord-origen-1",
  fecha_completado: "2026-01-05T00:00:00.000Z",
  clientes: {
    id: "cli-1",
    nombre: "Juan",
    email: null,
    telefono: "1122334455",
    dni: "30111222",
    cuit: null,
    razon_social: null,
    tipo_cliente: "INDIVIDUAL",
  },
  organizations: { nombre: "Taller", email: "taller@test.com" },
  tipos_dispositivo: {
    nombre: "Celular",
    config: { camposExtra: [{ key: "capacidad", label: "Capacidad", tipo: "text" }] },
  },
  sucursales: { nombre: "Sucursal Centro", direccion: "Av. Siempre Viva 123", telefono: "1155667788" },
  tecnico: { nombre: "Pedro Técnico" },
  recibidoPor: { nombre: "Ana Recepción" },
  repuestos_orden: [
    { nombre: null, cantidad: 2, precio_venta_unitario: 15000, inventario: { nombre: "Pantalla iPhone 13" } },
    { nombre: "Cable manual", cantidad: 1, precio_venta_unitario: 3000, inventario: null },
  ],
  garantias: { dias_validez: 90, fecha_vencimiento: "2026-04-05T00:00:00.000Z", notas: "Garantía completa" },
}

const ordenOrigen = { numero_orden: 41 }

const cobrosFixture = [
  { monto: 15000, metodo_pago: "EFECTIVO", numero_referencia: null, created_at: "2026-01-02T00:00:00.000Z" },
  { monto: 5000, metodo_pago: "TRANSFERENCIA", numero_referencia: "REF-1", created_at: "2026-01-03T00:00:00.000Z" },
]

// Segunda fila de EN_DIAGNOSTICO (reintento) NO debe duplicar el paso en el timeline.
const tiemposFixture = [
  { estado: "RECIBIDO", inicio: "2026-01-01T00:00:00.000Z" },
  { estado: "EN_DIAGNOSTICO", inicio: "2026-01-02T00:00:00.000Z" },
  { estado: "EN_DIAGNOSTICO", inicio: "2026-01-02T12:00:00.000Z" },
  { estado: "REPARADO", inicio: "2026-01-04T00:00:00.000Z" },
]

/**
 * `mockSupabaseFrom` (ver helpers.ts) le da una sola cadena por tabla a
 * `supabaseAdmin.from`, pero esta ruta consulta `ordenes_servicio` dos
 * veces cuando hay reingreso: una vez para la orden principal y otra para
 * resolver `orden_origen_id -> numero_orden`. Este helper local intercala
 * una segunda cadena para esa segunda llamada.
 */
function mockOrdenesServicioSequence(mainRow: any, origenRow: any | null, otherTables: Record<string, any>) {
  let call = 0
  const mainChain = createChainMock(mainRow, null)
  const origenChain = createChainMock(origenRow, null)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ordenes_servicio") {
      call += 1
      return (call === 1 ? mainChain : origenChain) as any
    }
    return (otherTables[table] || createChainMock(null, { message: `No mock for table: ${table}` })) as any
  })
}

describe("GET /api/ordenes/[id]/pdf — data layer del expediente (Task D2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("con filas nuevas presentes, pdfData lleva los campos mapeados", async () => {
    mockOrdenesServicioSequence(ordenCompleta, ordenOrigen, {
      checklist_recepcion: createChainMock(null, null),
      fotos_orden: createChainMock([], null),
      cobros_orden: createChainMock(cobrosFixture, null),
      orden_tiempos_estado: createChainMock(tiemposFixture, null),
    })

    const res = await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })
    expect(res.status).toBe(200)

    const pdfData: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]

    expect(pdfData.codigoOrden).toBe("CEL001")
    expect(pdfData.diagnostico).toBe("Pantalla rota, se reemplaza módulo")
    expect(pdfData.costoFinal).toBe(50000)
    expect(pdfData.totalCobrado).toBe(20000)
    expect(pdfData.estadoCobro).toBe("PARCIAL")
    expect(pdfData.descuentoCobro).toBe(1000)
    expect(pdfData.motivoSinCobro).toBeNull()
    expect(pdfData.telefonoContacto).toBe("1122334455")
    expect(pdfData.esReingreso).toBe(true)
    expect(pdfData.ordenOrigenNumero).toBe(41)
    expect(pdfData.fechaCompletado).toEqual(new Date("2026-01-05T00:00:00.000Z"))
    expect(pdfData.emailEmpresa).toBe("taller@test.com")

    expect(pdfData.cliente.dni).toBe("30111222")
    expect(pdfData.cliente.cuit).toBeNull()
    expect(pdfData.cliente.razonSocial).toBeNull()
    expect(pdfData.cliente.tipoCliente).toBe("INDIVIDUAL")

    expect(pdfData.sucursal).toEqual({
      nombre: "Sucursal Centro",
      direccion: "Av. Siempre Viva 123",
      telefono: "1155667788",
    })
    expect(pdfData.tecnicoNombre).toBe("Pedro Técnico")
    expect(pdfData.recibidoPorNombre).toBe("Ana Recepción")

    // metadata: "capacidad" resuelve label desde camposExtra; "legado" no
    // tiene config asociada y cae al key crudo como label.
    expect(pdfData.metadataCampos).toEqual(
      expect.arrayContaining([
        { label: "Capacidad", valor: "128GB" },
        { label: "legado", valor: "valor-sin-config" },
      ])
    )
    expect(pdfData.metadataCampos).toHaveLength(2)

    // trabajos: precio de VENTA * cantidad, nombre resuelto (manual o join a inventario).
    // Nunca precio_unitario (costo) — ese campo ni siquiera se pide al select.
    expect(pdfData.trabajos).toEqual([
      { nombre: "Pantalla iPhone 13", cantidad: 2, importe: 30000 },
      { nombre: "Cable manual", cantidad: 1, importe: 3000 },
    ])

    expect(pdfData.garantia).toEqual({
      dias: 90,
      fechaVencimiento: new Date("2026-04-05T00:00:00.000Z"),
      notas: "Garantía completa",
    })

    expect(pdfData.cobros).toEqual([
      { fecha: new Date("2026-01-02T00:00:00.000Z"), metodo: "EFECTIVO", referencia: null, monto: 15000 },
      { fecha: new Date("2026-01-03T00:00:00.000Z"), metodo: "TRANSFERENCIA", referencia: "REF-1", monto: 5000 },
    ])

    // timeline: primera ocurrencia por estado únicamente (el segundo
    // EN_DIAGNOSTICO del fixture no debe aparecer).
    expect(pdfData.timeline).toEqual([
      { estado: "RECIBIDO", fecha: new Date("2026-01-01T00:00:00.000Z") },
      { estado: "EN_DIAGNOSTICO", fecha: new Date("2026-01-02T00:00:00.000Z") },
      { estado: "REPARADO", fecha: new Date("2026-01-04T00:00:00.000Z") },
    ])

    // Mirror del guard de "sin filas nuevas": con es_reingreso true SI debe
    // dispararse la segunda llamada a ordenes_servicio (orden principal +
    // resolver orden_origen_id -> numero_orden).
    const ordenesServicioCalls = vi.mocked(supabaseAdmin.from).mock.calls.filter(
      (c) => c[0] === "ordenes_servicio"
    )
    expect(ordenesServicioCalls).toHaveLength(2)
  })

  it("sin filas nuevas, los campos quedan null/undefined en vez de romper", async () => {
    const ordenMinima = {
      ...ordenCompleta,
      sucursal_id: null,
      tecnico_id: null,
      recibido_por: null,
      metadata: {},
      es_reingreso: false,
      orden_origen_id: null,
      fecha_completado: null,
      motivo_sin_cobro: null,
      tipos_dispositivo: { nombre: "Celular", config: null },
      sucursales: null,
      tecnico: null,
      recibidoPor: null,
      repuestos_orden: [],
      garantias: null,
      clientes: { ...ordenCompleta.clientes, dni: null, cuit: null, razon_social: null, tipo_cliente: null },
    }

    mockOrdenesServicioSequence(ordenMinima, null, {
      checklist_recepcion: createChainMock(null, null),
      fotos_orden: createChainMock([], null),
      cobros_orden: createChainMock([], null),
      orden_tiempos_estado: createChainMock([], null),
    })

    const res = await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })
    expect(res.status).toBe(200)

    const pdfData: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]

    expect(pdfData.esReingreso).toBe(false)
    expect(pdfData.ordenOrigenNumero).toBeNull()
    expect(pdfData.fechaCompletado).toBeNull()
    expect(pdfData.sucursal).toBeNull()
    expect(pdfData.tecnicoNombre).toBeNull()
    expect(pdfData.recibidoPorNombre).toBeNull()
    expect(pdfData.metadataCampos).toBeNull()
    expect(pdfData.trabajos).toBeNull()
    expect(pdfData.garantia).toBeNull()
    expect(pdfData.cobros).toBeNull()
    expect(pdfData.timeline).toBeNull()
    expect(pdfData.cliente.dni).toBeNull()
    expect(pdfData.cliente.cuit).toBeNull()
    expect(pdfData.cliente.razonSocial).toBeNull()
    expect(pdfData.cliente.tipoCliente).toBeNull()

    // La segunda llamada a ordenes_servicio (resolver orden_origen_id) NO
    // debe dispararse cuando es_reingreso es false: solo 1 llamada a la
    // tabla (la orden principal), no 2.
    const ordenesServicioCalls = vi.mocked(supabaseAdmin.from).mock.calls.filter(
      (c) => c[0] === "ordenes_servicio"
    )
    expect(ordenesServicioCalls).toHaveLength(1)
  })

  it("el checklist mapea categoria por item", async () => {
    mockOrdenesServicioSequence(ordenCompleta, ordenOrigen, {
      checklist_recepcion: createChainMock(
        {
          valores: { "item-1": true, "item-2": "OK" },
          notas: null,
          firma_cliente: null,
          firma_mime: null,
          checklist_templates: {
            checklist_template_items: [
              { id: "item-1", label: "Pantalla encendida", orden: 1, categoria: "FUNCIONAL" },
              { id: "item-2", label: "Estado carcasa", orden: 2, categoria: "ESTETICO" },
            ],
          },
        },
        null
      ),
      fotos_orden: createChainMock([], null),
      cobros_orden: createChainMock([], null),
      orden_tiempos_estado: createChainMock([], null),
    })

    const res = await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })
    expect(res.status).toBe(200)

    const pdfData: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]
    expect(pdfData.checklistItems).toEqual([
      { label: "Pantalla encendida", valor: true, categoria: "FUNCIONAL" },
      { label: "Estado carcasa", valor: "OK", categoria: "ESTETICO" },
    ])
  })
})

describe("GET /api/public/ordenes/[token]/pdf — solo diagnostico + codigoOrden + timeline (Task D2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const publicToken = "a".repeat(32)

  it("agrega diagnostico, codigoOrden y timeline; nada mas del expediente se filtra", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(
        { ...ordenCompleta, public_token: publicToken, public_token_expires_at: null },
        null
      ),
      checklist_recepcion: createChainMock(null, null),
      fotos_orden: createChainMock([], null),
      orden_tiempos_estado: createChainMock(tiemposFixture, null),
    })

    const res = await GET_PUBLIC_PDF(createGetRequest(), { params: Promise.resolve({ token: publicToken }) })
    expect(res.status).toBe(200)

    const pdfData: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]

    expect(pdfData.diagnostico).toBe("Pantalla rota, se reemplaza módulo")
    expect(pdfData.codigoOrden).toBe("CEL001")
    expect(pdfData.timeline).toEqual([
      { estado: "RECIBIDO", fecha: new Date("2026-01-01T00:00:00.000Z") },
      { estado: "EN_DIAGNOSTICO", fecha: new Date("2026-01-02T00:00:00.000Z") },
      { estado: "REPARADO", fecha: new Date("2026-01-04T00:00:00.000Z") },
    ])

    // Nada mas del expediente debe filtrarse a la copia publica/cliente.
    expect(pdfData.costoFinal).toBeUndefined()
    expect(pdfData.totalCobrado).toBeUndefined()
    expect(pdfData.estadoCobro).toBeUndefined()
    expect(pdfData.descuentoCobro).toBeUndefined()
    expect(pdfData.motivoSinCobro).toBeUndefined()
    expect(pdfData.telefonoContacto).toBeUndefined()
    expect(pdfData.metadataCampos).toBeUndefined()
    expect(pdfData.sucursal).toBeUndefined()
    expect(pdfData.tecnicoNombre).toBeUndefined()
    expect(pdfData.recibidoPorNombre).toBeUndefined()
    expect(pdfData.trabajos).toBeUndefined()
    expect(pdfData.garantia).toBeUndefined()
    expect(pdfData.cobros).toBeUndefined()
    expect(pdfData.emailEmpresa).toBeUndefined()
    expect(pdfData.cliente.dni).toBeUndefined()
    expect(pdfData.cliente.cuit).toBeUndefined()
    expect(pdfData.cliente.razonSocial).toBeUndefined()
    expect(pdfData.cliente.tipoCliente).toBeUndefined()
  })
})
