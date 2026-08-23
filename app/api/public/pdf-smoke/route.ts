import { NextResponse } from "next/server"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateReciboCCPDF, generateResumenCCPDF } from "@/lib/cuenta-corriente-react-pdf"

// CI-only. Renders every react-pdf document from fixtures inside a real
// production bundle — no database, no auth, no tenant. That is exactly the
// setup under which React error #31 reproduced (see the #323 postmortem in
// the design doc): the failure is in the bundle, not in the data.
//
// Gated on PDF_SMOKE, which only the CI Build job sets. Production never
// sets it, so this route is a 404 there.
export const dynamic = "force-dynamic"

const FECHA = new Date("2026-08-20T15:00:00Z")

// logoUrl is deliberately non-empty: fetchLogo() short-circuits to null when
// it's absent, and every document gates <Image> behind that null check. A
// fixture with no logo exercises zero image-embedding code, so a bundle-level
// regression isolated to <Image> would pass this smoke check while still
// breaking production, where tenants do have logos. The inline data: URL
// needs no network and no real asset — fetch() resolves data: URLs and
// reports content-type: image/png, so fetchLogo sniffs it as a real PNG.
// Do not "simplify" this away.
const LOGO_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

const EMISOR = {
  nombreEmpresa: "Smoke Test SRL",
  telefonoEmpresa: "+54 11 4000-0000",
  direccionEmpresa: "Av. Siempreviva 742",
  cuitEmpresa: "20123456789",
  condicionIvaEmpresa: "Responsable Inscripto",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  logoUrl: LOGO_URL,
}

export async function GET() {
  if (process.env.PDF_SMOKE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const [remito, reciboCC, resumenCC] = await Promise.all([
      generateFacturaPDFReact({
        ...EMISOR,
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
      }),

      generateReciboCCPDF({
        ...EMISOR,
        numeroRecibo: "REC-00001",
        fecha: FECHA,
        tipo: "DEPOSITO",
        monto: 1000,
        saldoPosterior: 1000,
        metodoPago: "EFECTIVO",
        cliente: { nombre: "Cliente Smoke" },
      }),

      generateResumenCCPDF({
        ...EMISOR,
        desde: "2026-08-01",
        hasta: "2026-08-31",
        saldoInicial: 0,
        saldoFinal: 1000,
        movimientos: [
          { fecha: FECHA, tipo: "DEPOSITO", monto: 1000, saldoPosterior: 1000, metodoPago: "EFECTIVO" },
        ],
        cliente: { nombre: "Cliente Smoke" },
      }),
    ])

    return NextResponse.json({
      ok: true,
      documentos: {
        remito: remito.length,
        reciboCC: reciboCC.length,
        resumenCC: resumenCC.length,
      },
    })
  } catch (error) {
    // The whole point: surface the real error instead of a generic 500, so CI
    // logs name the failure the way the Vercel logs eventually named #31.
    console.error("pdf-smoke failed:", error)
    return NextResponse.json(
      { ok: false, error: (error as Error).message, stack: (error as Error).stack?.split("\n").slice(0, 8) },
      { status: 500 }
    )
  }
}
