import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"
import type { NotaCreditoDocumento } from "@/lib/notas-credito/documento"

vi.mock("@/lib/notas-credito/documento", async () => {
  const real = await vi.importActual<typeof import("@/lib/notas-credito/documento")>("@/lib/notas-credito/documento")
  return { ...real, cargarDocumentoNC: vi.fn() }
})
vi.mock("@/lib/nota-credito-react-pdf", () => ({
  generateNotaCreditoPDF: vi.fn(async () => Buffer.from("%PDF-1.7 fake")),
}))

import { cargarDocumentoNC } from "@/lib/notas-credito/documento"
import { generateNotaCreditoPDF } from "@/lib/nota-credito-react-pdf"
import { GET as pdfNC } from "@/app/api/notas-credito/[id]/pdf/route"
import { GET as pdfDevolucion } from "@/app/api/ventas/[id]/devolucion/[devolucionId]/pdf/route"
import { notaCreditoPdfData } from "@/lib/notas-credito/pdf"

const doc: NotaCreditoDocumento = {
  id: "nc-v", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "DEV-0042",
  fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivoNc: null, detalle: "Producto con falla",
  observaciones: null, items: [{ descripcion: "Funda", cantidad: 1, precioUnitario: 100, subtotal: 100 }],
  monto: 100, montoAplicadoDeuda: 0, montoReembolso: 100, metodo: "CREDITO_TIENDA",
  pendienteActual: 0, anulada: false, anuladaAt: null, anuladaMotivo: null,
  cliente: { nombre: "Juan", dni: null, telefono: null, email: null, direccion: null },
  sucursalNombre: "Centro", atendidoPor: "Ana",
  emisor: {
    nombreEmpresa: "Taller", telefonoEmpresa: null, direccionEmpresa: null, domicilioFiscalEmpresa: null,
    cuitEmpresa: null, condicionIvaEmpresa: null, pais: "AR", logoUrl: null, moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
  },
}

describe("notaCreditoPdfData", () => {
  // Review Focus 1: el historial DEV- llega al PDF con palabras, no con códigos.
  it("traduce motivo y medio, y pasa el resto tal cual", () => {
    const data = notaCreditoPdfData(doc)
    expect(data).toMatchObject({
      numero: "DEV-0042", origen: "VENTA", operacion: "V0042",
      motivo: "Producto con falla", detalle: "Producto con falla",
      etiquetaReintegro: "Crédito a tu favor en el local",
      monto: 100, montoAplicadoDeuda: 0, montoReembolso: 100, pendienteActual: 0,
      nombreEmpresa: "Taller", moneda: "ARS", sucursalNombre: "Centro", atendidoPor: "Ana",
      cliente: { nombre: "Juan" },
    })
  })
})

describe("GET /api/notas-credito/[id]/pdf", () => {
  const get = (id = "nc-v") => pdfNC(createGetRequest(`http://localhost/api/notas-credito/${id}/pdf`), { params: Promise.resolve({ id }) })

  beforeEach(() => vi.clearAllMocks())

  it("sin sesión responde 401", async () => {
    mockAuthError()
    expect((await get()).status).toBe(401)
  })

  it("lo que el usuario no ve es 404 y no se genera nada", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue(null)
    const res = await parseResponse(await get())
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("Nota de crédito no encontrada")
    expect(generateNotaCreditoPDF).not.toHaveBeenCalled()
  })

  it("devuelve el PDF, privado y sin cache, con el número en el nombre", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "user-7", sucursalId: "suc-3" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue(doc)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="nota-credito-DEV-0042.pdf"')
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(cargarDocumentoNC).toHaveBeenCalledWith("nc-v", { organizationId: "org-1", userId: "user-7", role: "VENDEDOR", userSucursalId: "suc-3" })
    expect(generateNotaCreditoPDF).toHaveBeenCalledWith(notaCreditoPdfData(doc))
  })

  it("una falla al generar es 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue(doc)
    vi.mocked(generateNotaCreditoPDF).mockRejectedValueOnce(new Error("React #31"))
    expect((await get()).status).toBe(500)
  })
})

describe("GET /api/ventas/[id]/devolucion/[devolucionId]/pdf", () => {
  const get = (ventaId: string, devolucionId: string) =>
    pdfDevolucion(
      createGetRequest(`http://localhost/api/ventas/${ventaId}/devolucion/${devolucionId}/pdf`),
      { params: Promise.resolve({ id: ventaId, devolucionId }) }
    )

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.from).mockReturnValue(createChainMock({ tecnicos_operan_pos: false }) as any)
  })

  it("usa el generador nuevo para una devolución de esa venta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue(doc)
    const res = await get("v-1", "nc-v")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(generateNotaCreditoPDF).toHaveBeenCalledTimes(1)
  })

  it("una NC de OTRA venta pedida por esta URL es 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue({ ...doc, origenId: "v-otra" })
    expect((await get("v-1", "nc-v")).status).toBe(404)
    expect(generateNotaCreditoPDF).not.toHaveBeenCalled()
  })

  it("una NC de orden pedida como devolución es 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue({ ...doc, origen: "ORDEN", origenId: "v-1" })
    expect((await get("v-1", "nc-v")).status).toBe(404)
  })

  it("el técnico sin permiso de POS sigue recibiendo 403 antes de cargar nada", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    expect((await get("v-1", "nc-v")).status).toBe(403)
    expect(cargarDocumentoNC).not.toHaveBeenCalled()
  })
})
