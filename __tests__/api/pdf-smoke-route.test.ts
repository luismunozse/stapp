// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateReciboCCPDF, generateResumenCCPDF } from "@/lib/cuenta-corriente-react-pdf"

afterEach(() => {
  delete process.env.PDF_SMOKE
  vi.resetModules()
})

const FECHA = new Date("2026-08-20T15:00:00Z")
const LOGO_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

describe("GET /api/public/pdf-smoke", () => {
  it("404s when the smoke flag is not set, so production never exposes it", async () => {
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it("renders every react-pdf document when the flag is set", async () => {
    process.env.PDF_SMOKE = "1"
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    // Every document must render to a real PDF, not an empty buffer.
    for (const [nombre, bytes] of Object.entries(body.documentos)) {
      expect(bytes, `${nombre} rendered nothing`).toBeGreaterThan(1000)
    }
    expect(Object.keys(body.documentos).sort()).toEqual(["reciboCC", "remito", "resumenCC"])
  })

  // fetchLogo() short-circuits to null when logoUrl is absent, and every
  // document gates <Image> behind that null check. A fixture with no
  // logoUrl (the state before this test existed) would let the two tests
  // above pass while exercising zero image-embedding code — a bundle
  // regression isolated to <Image> would slip through. Proving the fixture
  // logo actually changes the rendered byte count is the only way to know
  // <Image> really mounted; asserting the fixture merely *has* a logoUrl
  // would still pass if that field were wired up but silently ignored.
  it("embeds a real logo in every document, not just a null placeholder", async () => {
    const reciboBase = {
      nombreEmpresa: "Smoke Test SRL",
      numeroRecibo: "REC-00001",
      fecha: FECHA,
      tipo: "DEPOSITO",
      monto: 1000,
      saldoPosterior: 1000,
      metodoPago: "EFECTIVO",
      cliente: { nombre: "Cliente Smoke" },
    }
    const resumenBase = {
      nombreEmpresa: "Smoke Test SRL",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      saldoInicial: 0,
      saldoFinal: 1000,
      movimientos: [
        { fecha: FECHA, tipo: "DEPOSITO", monto: 1000, saldoPosterior: 1000, metodoPago: "EFECTIVO" },
      ],
      cliente: { nombre: "Cliente Smoke" },
    }
    const remitoBase = {
      nombreEmpresa: "Smoke Test SRL",
      numeroFactura: "0001-00000001",
      fecha: FECHA,
      estadoPago: "PAGADO",
      cliente: { nombre: "Cliente Smoke" },
      venta: { numeroVenta: 1 },
      items: [{ descripcion: "Item smoke", cantidad: 1, precioUnitario: 1000, subtotal: 1000 }],
      subtotal: 1000,
      iva: 0,
      total: 1000,
      montoAbonado: 1000,
      pagos: [{ fecha: FECHA, metodoPago: "EFECTIVO", monto: 1000, referencia: "" }],
    }

    const [remitoCon, remitoSin] = await Promise.all([
      generateFacturaPDFReact({ ...remitoBase, logoUrl: LOGO_URL }),
      generateFacturaPDFReact(remitoBase),
    ])
    const [reciboCon, reciboSin] = await Promise.all([
      generateReciboCCPDF({ ...reciboBase, logoUrl: LOGO_URL }),
      generateReciboCCPDF(reciboBase),
    ])
    const [resumenCon, resumenSin] = await Promise.all([
      generateResumenCCPDF({ ...resumenBase, logoUrl: LOGO_URL }),
      generateResumenCCPDF(resumenBase),
    ])

    expect(remitoCon.length, "remito: logoUrl did not change rendered output").toBeGreaterThan(remitoSin.length)
    expect(reciboCon.length, "reciboCC: logoUrl did not change rendered output").toBeGreaterThan(reciboSin.length)
    expect(resumenCon.length, "resumenCC: logoUrl did not change rendered output").toBeGreaterThan(resumenSin.length)
  })
})
