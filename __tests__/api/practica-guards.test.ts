import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { mockAuthSuccess, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { ORDEN_PRACTICA_ERROR } from "@/lib/onboarding/practica-shared"
import { PUT as actualizarOrden } from "@/app/api/ordenes/[id]/route"
import { POST as entregarOrden } from "@/app/api/ordenes/[id]/entregar/route"
import { POST as cobrarOrden } from "@/app/api/ordenes/[id]/cobros/route"
import { POST as agregarRepuesto } from "@/app/api/ordenes/[id]/repuestos/route"
import { POST as agregarServicio, PATCH as aplicarServicios } from "@/app/api/ordenes/[id]/servicios/route"
import { POST as crearReingreso } from "@/app/api/ordenes/[id]/reingreso/route"
import { POST as crearCotizacion } from "@/app/api/cotizaciones/route"
import { POST as generarFactura } from "@/app/api/facturacion/generar/route"
import { POST as crearGarantia } from "@/app/api/garantias/route"
import { POST as crearNotaCredito } from "@/app/api/notas-credito/route"

const ORDEN = "ord-practica"
const ctx = () => ({ params: Promise.resolve({ id: ORDEN }) })

const casos: Array<[string, () => Promise<Response>]> = [
  ["PUT /api/ordenes/[id]", () => actualizarOrden(createPostRequest({ estado: "EN_REPARACION" }), ctx())],
  ["POST /api/ordenes/[id]/entregar", () => entregarOrden(createPostRequest({}), ctx())],
  ["POST /api/ordenes/[id]/cobros", () => cobrarOrden(createPostRequest({ pagos: [{ monto: 100, metodo: "EFECTIVO" }] }), ctx())],
  ["POST /api/ordenes/[id]/repuestos", () => agregarRepuesto(createPostRequest({ tipo: "manual", nombre: "Pantalla", cantidad: 1, precioUnitario: 10 }), ctx())],
  ["POST /api/ordenes/[id]/servicios", () => agregarServicio(createPostRequest({ tipo: "manual", nombre: "Mano de obra", cantidad: 1, precioUnitario: 100 }), ctx())],
  ["PATCH /api/ordenes/[id]/servicios", () => aplicarServicios(new Request("http://localhost/api/test", { method: "PATCH" }), ctx())],
  ["POST /api/ordenes/[id]/reingreso", () => crearReingreso(createPostRequest({ problemaReportado: "Volvió a fallar" }), ctx())],
  ["POST /api/cotizaciones", () => crearCotizacion(createPostRequest({ tipo: "ORDEN", ordenId: ORDEN, items: [{ descripcion: "Pantalla", cantidad: 1, precioUnitario: 100 }] }))],
  ["POST /api/facturacion/generar", () => generarFactura(createPostRequest({ ordenId: ORDEN }))],
  ["POST /api/garantias", () => crearGarantia(createPostRequest({ ordenId: ORDEN }))],
  ["POST /api/notas-credito", () => crearNotaCredito(createPostRequest({ ordenId: ORDEN, motivo: "DEVOLUCION", monto: 100, metodoDevolucion: "EFECTIVO" }))],
]

describe("money, stock, quote and invoice routes reject the practice order", () => {
  let chain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    chain = createChainMock({ id: ORDEN, organization_id: "org-1", estado: "REPARADO", es_practica: true })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)
    vi.mocked(rejectIfPractica).mockImplementation(async () => NextResponse.json(ORDEN_PRACTICA_ERROR, { status: 409 }))
  })

  it.each(casos)("%s returns 409 ORDEN_PRACTICA and writes nothing", async (_nombre, llamar) => {
    const { status, body } = await parseResponse(await llamar())
    expect(status).toBe(409)
    expect(body).toEqual(ORDEN_PRACTICA_ERROR)
    expect(rejectIfPractica).toHaveBeenCalledWith(ORDEN, "org-1")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    for (const m of ["insert", "update", "upsert", "delete"]) {
      expect(chain[m]).not.toHaveBeenCalled()
    }
  })
})
