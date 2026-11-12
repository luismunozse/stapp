/**
 * GET /api/ordenes/[id]/informe: arma el informe técnico con los datos de la
 * orden, los avances visibles y las fotos que ve el cliente. El dibujo tiene
 * sus propios tests; acá se fija qué datos le llegan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest } from "./helpers"

vi.mock("@/lib/informe-tecnico-react-pdf", () => ({
  generateInformeTecnicoPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))
vi.mock("@/lib/terminologia-server", () => ({ getTerminologia: vi.fn().mockResolvedValue(null) }))

import { GET } from "@/app/api/ordenes/[id]/informe/route"
import { generateInformeTecnicoPDF } from "@/lib/informe-tecnico-react-pdf"

const ORDEN = {
  id: "ord-1",
  numero_orden: 42,
  codigo_orden: "CEL0042",
  organization_id: "org-1",
  sucursal_id: "suc-1",
  tecnico_id: "tec-1",
  estado: "ENTREGADO",
  dispositivo: "A52",
  marca: "Samsung",
  tipo_dispositivo: "CELULAR",
  imei: "358400123456789",
  problema_reportado: "No carga",
  diagnostico: "Conector sulfatado",
  notas_internas: "NO DEBE SALIR",
  fecha_ingreso: "2026-11-01T15:00:00Z",
  fecha_entrega: "2026-11-08T15:00:00Z",
  costo_final: 20000,
  clientes: { nombre: "Ana", telefono: "341" },
  organizations: { nombre: "Taller", moneda: "ARS" },
  tipos_dispositivo: { nombre: "Celular" },
  tecnico: { nombre: "L. Ferreyra" },
  repuestos_orden: [{ nombre: "Conector", cantidad: 1, precio_venta_unitario: 12000, precio_unitario: 3000 }],
  servicios_orden: [],
  garantias: [{ dias_validez: 90, fecha_vencimiento: "2027-02-06T15:00:00Z", estado: "ACTIVA" }],
}

// PNG de 1x1 real: la ruta lo pasa a JPEG con sharp.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

const params = { params: Promise.resolve({ id: "ord-1" }) }

let download: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess({ organizationId: "org-1", role: "ADMIN", userId: "adm-1" })
  download = vi.fn().mockResolvedValue({ data: { arrayBuffer: async () => Uint8Array.from(PNG_1X1).buffer }, error: null })
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ download } as any)
  mockSupabaseFrom({
    ordenes_servicio: createChainMock(ORDEN),
    orden_eventos: createChainMock([
      { descripcion: "Visible", created_at: "2026-11-03T15:00:00Z", metadata: { visible_cliente: true } },
      { descripcion: "Interno", created_at: "2026-11-04T15:00:00Z", metadata: { visible_cliente: false } },
    ]),
    fotos_orden: createChainMock([
      { url: null, storage_path: "org-1/ord-1/a.jpg", tipo: "ENTREGA", descripcion: "Equipo listo", created_at: "2026-11-08T15:00:00Z" },
      { url: null, storage_path: "org-1/ord-1/b.jpg", tipo: "DIAGNOSTICO", descripcion: "Interna", created_at: "2026-11-02T15:00:00Z" },
    ]),
  })
})

describe("GET /api/ordenes/[id]/informe", () => {
  it("devuelve un PDF con los datos de la orden para el cliente", async () => {
    const res = await GET(createGetRequest("http://localhost/api/ordenes/ord-1/informe"), params)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    const data = vi.mocked(generateInformeTecnicoPDF).mock.calls[0][0]
    expect(data.codigoOrden).toBe("CEL0042")
    expect(data.equipo).toEqual(expect.objectContaining({ marca: "Samsung", identificadorLabel: "IMEI" }))
    expect(data.diagnostico).toBe("Conector sulfatado")
    // Precio de venta, nunca el costo.
    expect(data.trabajos).toEqual([expect.objectContaining({ nombre: "Conector", importe: 12000 })])
    expect(data.garantia).toEqual(expect.objectContaining({ dias: 90 }))
    expect(JSON.stringify(data)).not.toContain("NO DEBE SALIR")
  })

  it("solo los avances visibles y las fotos que ve el cliente", async () => {
    await GET(createGetRequest("http://localhost/api/ordenes/ord-1/informe"), params)

    const data = vi.mocked(generateInformeTecnicoPDF).mock.calls[0][0]
    expect(data.avances.map((a) => a.texto)).toEqual(["Visible"])
    expect(data.fotos.map((f) => f.descripcion)).toEqual(["Equipo listo"])
    expect(data.fotos[0].etiqueta).toBe("Al entregar")
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith("org-1/ord-1/a.jpg")
  })

  it("una foto que no se puede bajar no frena el informe", async () => {
    download.mockResolvedValue({ data: null, error: { message: "not found" } })
    const res = await GET(createGetRequest("http://localhost/api/ordenes/ord-1/informe"), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(generateInformeTecnicoPDF).mock.calls[0][0].fotos).toEqual([])
  })

  it("una orden de otra sucursal es 404 para un técnico ajeno", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO", userId: "otro", sucursalId: "suc-2" })
    const res = await GET(createGetRequest("http://localhost/api/ordenes/ord-1/informe"), params)

    expect(res.status).toBe(404)
    expect(generateInformeTecnicoPDF).not.toHaveBeenCalled()
  })
})
