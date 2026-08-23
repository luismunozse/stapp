// @vitest-environment node
/**
 * Position-level golden check for the A4 react-pdf documents. Skipped unless
 * PDF_GOLDEN=1 — it is a refactor instrument, not a per-commit test.
 *
 * See __tests__/lib/pdf-golden-helper.ts for what it compares, what it does
 * not, and the two-run usage. In short:
 *
 *   PDF_GOLDEN=1 PDF_GOLDEN_OUT=.tmp-preview/golden-base.json \
 *     npx vitest run __tests__/pdf-golden.test.ts          # on the base commit
 *
 *   PDF_GOLDEN=1 PDF_GOLDEN_OUT=.tmp-preview/golden-head.json \
 *     PDF_GOLDEN_BASE=.tmp-preview/golden-base.json \
 *     npx vitest run __tests__/pdf-golden.test.ts          # after the change
 *
 * The fixtures below are chosen to exercise the geometry the suites cannot
 * see: the reserved logo box, both left-zone truncation budgets, the wrap
 * boundaries either side of them, the conditional emisor/cliente rows that
 * shift each other, and multipage flow.
 */
import { describe, it, expect } from "vitest"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateReciboCCPDF, generateResumenCCPDF } from "@/lib/cuenta-corriente-react-pdf"
import { dumpPositions, dumpGraphics, diffDumps, type GoldenDump } from "./lib/pdf-golden-helper"

const OUT = process.env.PDF_GOLDEN_OUT ?? ".tmp-preview/golden-head.json"
const BASE = process.env.PDF_GOLDEN_BASE

// A minimal valid 1x1 PNG as a data: URI — Node's fetch resolves it locally,
// so the logo path is exercised without touching the network.
const tinyPngDataUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

const baseData = {
  numeroFactura: "0001-00000008",
  fecha: new Date("2026-08-17"),
  estadoPago: "PAGADO",
  cliente: { nombre: "Consumidor Final" },
  venta: { numeroVenta: 22 },
  subtotal: 3000,
  iva: 0,
  total: 3000,
  montoAbonado: 3000,
  pagos: [],
}

const typicalRemito = {
  numeroFactura: "0001-00000099",
  fecha: new Date("2026-08-17"),
  estadoPago: "PAGADO_PARCIAL",
  cliente: { nombre: "Juan Pérez" },
  orden: { numeroOrden: 99, codigoOrden: "CEL099", dispositivo: "iPhone 13" },
  telefonoEmpresa: "011-4444-5555",
  direccionEmpresa: "Av. Siempre Viva 742",
  cuitEmpresa: "30-71234567-8",
  ingresosBrutosEmpresa: "901-123456-7",
  inicioActividadesEmpresa: "01/2015",
  condicionIvaEmpresa: "Responsable Inscripto",
  vencimiento: new Date("2026-09-17"),
  mediosPago: "Efectivo, transferencia, tarjeta",
  cbuAlias: "stapp.taller.mp",
  items: [
    { descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 30000, subtotal: 30000 },
    { descripcion: "Cambio de batería", cantidad: 1, precioUnitario: 15000, subtotal: 15000 },
    { descripcion: "Mano de obra", cantidad: 1, precioUnitario: 5000, subtotal: 5000 },
  ],
  subtotal: 50000,
  iva: 0,
  total: 50000,
  montoAbonado: 30000,
  pagos: [
    { monto: 15000, metodoPago: "TARJETA_CREDITO", fecha: new Date("2026-08-17"), referencia: "AUT-001", cuotas: 3, recargoPorcentaje: 10 },
    { monto: 10000, metodoPago: "EFECTIVO", fecha: new Date("2026-08-17"), referencia: "REC-002" },
    { monto: 5000, metodoPago: "TRANSFERENCIA", fecha: new Date("2026-08-17"), referencia: "REC-003" },
  ],
}

const remitoFixtures: Record<string, unknown> = {
  "01-minimal": baseData,
  "02-typical": typicalRemito,
  "03-typical-logo": { ...typicalRemito, logoUrl: tinyPngDataUri },
  // Bold@9 = 157.16pt: fits the no-logo company-name budget (220.64pt),
  // overflows the with-logo one (125.64pt). Pins the logo box's own width.
  "04-boundary-name": { ...baseData, nombreEmpresa: "Reparaciones El Sol Servicios S.R.L." },
  "05-boundary-name-logo": { ...baseData, nombreEmpresa: "Reparaciones El Sol Servicios S.R.L.", logoUrl: tinyPngDataUri },
  "06-long-name": { ...baseData, nombreEmpresa: "Servicio Técnico Integral de Reparaciones y Mantenimiento S.R.L." },
  // Regular@8 = ~175.15pt: clears the letter box (220.64pt) but not the
  // legend (170.14pt) — pins the legend-aware budget for the data rows.
  "07-long-direccion": {
    ...baseData,
    nombreEmpresa: "Taller Central",
    direccionEmpresa: "Av. Presidente Roque Sáenz Peña 1178, 5to Piso",
  },
  "08-two-addresses": {
    ...baseData,
    nombreEmpresa: "Taller Central",
    telefonoEmpresa: "011-4444-5555",
    direccionEmpresa: "Calle Comercial 100",
    domicilioFiscalEmpresa: "Domicilio Fiscal 200",
  },
  // Uncapped cliente nombre + email: pins the cliente column's own width.
  "09-long-cliente": {
    ...baseData,
    cliente: {
      nombre: "Distribuidora Mayorista del Litoral Argentino Sociedad Anónima",
      dni: "30-71234567-8",
      telefono: "011-5555-6666",
      email: "administracion.cuentas.corrientes@distribuidoralitoral.com.ar",
      direccion: "Av. Presidente Roque Sáenz Peña 1178, 5to Piso, Oficina 12, CABA",
    },
    orden: { numeroOrden: 8, codigoOrden: "ORD-0008", dispositivo: "Notebook Lenovo ThinkPad" },
    venta: undefined,
  },
  "10-full-fiscal-logo": {
    ...baseData,
    logoUrl: tinyPngDataUri,
    nombreEmpresa: "Taller Central",
    telefonoEmpresa: "011-4444-5555",
    direccionEmpresa: "Calle Comercial 100",
    domicilioFiscalEmpresa: "Domicilio Fiscal 200",
    cuitEmpresa: "23944498389",
    condicionIvaEmpresa: "Monotributo",
    ingresosBrutosEmpresa: "902-123456-7",
    inicioActividadesEmpresa: "01/2020",
    fechaOperacion: new Date("2026-08-01"),
  },
  "11-many-items": {
    ...baseData,
    items: Array.from({ length: 60 }, (_, i) => ({
      descripcion: `Item ${i + 1}`,
      cantidad: 1,
      precioUnitario: 100,
      subtotal: 100,
    })),
    subtotal: 6000,
    total: 6000,
    montoAbonado: 0,
  },
  // Bold@9 = 174.17pt: BETWEEN the company-name budget (220.64pt) and the
  // legend-aware one (170.14pt). Collapsing the two budgets truncates this
  // name; nothing else in the suite notices.
  "12-midband-name": { ...baseData, nombreEmpresa: "Reparaciones El Sol Servicios Integrales" },
  "13-midband-name-tel": {
    ...baseData,
    nombreEmpresa: "Reparaciones El Sol Servicios Integrales",
    telefonoEmpresa: "011-4444-5555",
  },
  // A declared-but-blank número still owns its row's 2pt margin.
  "14-empty-numero": { ...baseData, numeroFactura: "" },
  // BOTH tables overflow, so their repeating headers interleave across four
  // pages. Added in task 7: "11-many-items" only ever paginates one table, and
  // a table header that repeats correctly on its own can still leak onto the
  // other table's pages — the exact failure mode `headerFijo` is accused of.
  // The pagos rows carry the cuotas/recargo note, which is the taller row
  // shape and moves every page break.
  "15-both-tables-overflow": {
    ...baseData,
    items: Array.from({ length: 60 }, (_, i) => ({
      descripcion: `Item ${i + 1}`,
      cantidad: 1,
      precioUnitario: 100,
      subtotal: 100,
    })),
    subtotal: 6000,
    total: 6000,
    montoAbonado: 6000,
    pagos: Array.from({ length: 60 }, (_, i) => ({
      monto: 100,
      metodoPago: "TARJETA_CREDITO",
      fecha: new Date("2026-08-17"),
      referencia: `REF-${String(i + 1).padStart(3, "0")}`,
      cuotas: 3,
      recargoPorcentaje: 10,
    })),
  },
}

const reciboBase = {
  numeroRecibo: "REC-00007",
  fecha: new Date("2026-08-17"),
  tipo: "PAGO",
  monto: 5000,
  saldoPosterior: -2000,
}

const reciboFixtures: Record<string, unknown> = {
  "01-minimal": { ...reciboBase, cliente: { nombre: "Juan Pérez" } },
  "02-full": {
    ...reciboBase,
    cliente: {
      nombre: "Distribuidora Mayorista del Litoral Argentino Sociedad Anónima",
      dni: "30-71234567-8",
      telefono: "011-5555-6666",
      email: "administracion.cuentas.corrientes@distribuidoralitoral.com.ar",
      direccion: "Av. Presidente Roque Sáenz Peña 1178, 5to Piso, Oficina 12, CABA",
    },
    nombreEmpresa: "Servicio Técnico Integral de Reparaciones y Mantenimiento S.R.L.",
    telefonoEmpresa: "011-4444-5555",
    direccionEmpresa: "Av. Presidente Roque Sáenz Peña 1178, 5to Piso",
    domicilioFiscalEmpresa: "Domicilio Fiscal 200",
    cuitEmpresa: "30-71234567-8",
    condicionIvaEmpresa: "Responsable Inscripto",
    sucursalNombre: "Sucursal Centro",
    atendidoPor: "María González",
    metodoPago: "TRANSFERENCIA",
    numeroReferencia: "TRF-00123",
    observaciones: "Pago parcial acordado con el cliente.",
  },
  "03-logo": {
    ...reciboBase,
    cliente: { nombre: "Juan Pérez", dni: "30123456" },
    logoUrl: tinyPngDataUri,
    nombreEmpresa: "Reparaciones El Sol Servicios S.R.L.",
    telefonoEmpresa: "011-4444-5555",
    direccionEmpresa: "Calle Comercial 100",
    cuitEmpresa: "30-71234567-8",
    condicionIvaEmpresa: "Monotributo",
  },
}

const resumenFixtures: Record<string, unknown> = {
  "01-minimal": {
    cliente: { nombre: "Juan Pérez" },
    desde: new Date("2026-07-01"),
    hasta: new Date("2026-07-31"),
    saldoInicial: 0,
    saldoFinal: 0,
    movimientos: [],
  },
  "02-full": {
    cliente: {
      nombre: "Distribuidora Mayorista del Litoral Argentino Sociedad Anónima",
      dni: "30-71234567-8",
      telefono: "011-5555-6666",
      email: "administracion.cuentas.corrientes@distribuidoralitoral.com.ar",
      direccion: "Av. Presidente Roque Sáenz Peña 1178, 5to Piso, Oficina 12, CABA",
    },
    nombreEmpresa: "Servicio Técnico Integral de Reparaciones y Mantenimiento S.R.L.",
    telefonoEmpresa: "011-4444-5555",
    direccionEmpresa: "Av. Presidente Roque Sáenz Peña 1178, 5to Piso",
    domicilioFiscalEmpresa: "Domicilio Fiscal 200",
    cuitEmpresa: "30-71234567-8",
    condicionIvaEmpresa: "Responsable Inscripto",
    sucursalNombre: "Sucursal Centro",
    atendidoPor: "María González",
    logoUrl: tinyPngDataUri,
    desde: new Date("2026-07-01"),
    hasta: new Date("2026-07-31"),
    saldoInicial: -1000,
    saldoFinal: -3500,
    movimientos: Array.from({ length: 12 }, (_, i) => ({
      fecha: new Date(2026, 6, i + 1),
      tipo: i % 2 === 0 ? "CARGO" : "PAGO",
      monto: i % 2 === 0 ? -500 : 300,
      saldoPosterior: -1000 - i * 200,
      metodoPago: "EFECTIVO",
      numeroReferencia: `REF-${i}`,
    })),
  },
  // The resumen's PAGINATED form. "02-full" tops out at 12 movimientos and
  // fits one page, which left the repeated header, the grey band on page 2+,
  // the continuation pages' own cell borders and the `pie` totals row landing
  // after a split entirely outside the golden proof — the mirror of what
  // "remito/15-both-tables-overflow" covers for the other document. Every
  // other movimiento carries a metodoPago, so the taller two-line row shape
  // is what moves the page breaks, exactly as it does in production.
  "03-multipagina": {
    cliente: { nombre: "Distribuidora Mayorista del Litoral Argentino Sociedad Anónima", dni: "30-71234567-8" },
    nombreEmpresa: "Servicio Técnico Integral de Reparaciones y Mantenimiento S.R.L.",
    cuitEmpresa: "30-71234567-8",
    condicionIvaEmpresa: "Responsable Inscripto",
    logoUrl: tinyPngDataUri,
    desde: new Date("2026-05-01"),
    hasta: new Date("2026-07-31"),
    saldoInicial: -1000,
    saldoFinal: -13000,
    movimientos: Array.from({ length: 60 }, (_, i) => ({
      fecha: new Date(2026, 4 + (i % 3), (i % 28) + 1),
      tipo: i % 2 === 0 ? "CARGO" : "PAGO",
      monto: i % 2 === 0 ? -500 : 300,
      saldoPosterior: -1000 - i * 200,
      metodoPago: i % 2 === 0 ? "TRANSFERENCIA" : null,
      numeroReferencia: `REF-${String(i + 1).padStart(3, "0")}`,
    })),
  },
}

describe.runIf(process.env.PDF_GOLDEN === "1")("pdf golden positions", () => {
  it("renders every fixture and, given a baseline, matches it exactly", async () => {
    const dump: GoldenDump = {}

    // Two slots per fixture: the text-item positions and, since task 7, the
    // page content streams' graphics operators. Tables are ruled rectangles
    // and borders that emit no text at all, so the "[gfx]" slot is the only
    // one that can see a shifted column divider or a changed border colour.
    const registrar = async (slot: string, buffer: Buffer) => {
      dump[slot] = await dumpPositions(buffer)
      dump[`${slot} [gfx]`] = await dumpGraphics(buffer)
    }

    for (const [name, data] of Object.entries(remitoFixtures)) {
      await registrar(`remito/${name}`, await generateFacturaPDFReact(data as never))
    }
    for (const [name, data] of Object.entries(reciboFixtures)) {
      await registrar(`recibo/${name}`, await generateReciboCCPDF(data as never))
    }
    for (const [name, data] of Object.entries(resumenFixtures)) {
      await registrar(`resumen/${name}`, await generateResumenCCPDF(data as never))
    }

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify(dump, null, 1))

    if (!BASE) {
      console.log(`[pdf-golden] wrote ${Object.keys(dump).length} fixtures to ${OUT} (no baseline to compare)`)
      return
    }

    expect(existsSync(BASE), `PDF_GOLDEN_BASE not found: ${BASE}`).toBe(true)
    const base = JSON.parse(readFileSync(BASE, "utf8")) as GoldenDump
    const diffs = diffDumps(base, dump)
    expect(diffs.join("\n"), `layout moved vs ${BASE}`).toBe("")
  }, 300000)
})
