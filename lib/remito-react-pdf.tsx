// react-pdf remito engine — seeded from the spike component
// (spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx). Renders the
// classic remito via @react-pdf/renderer flexbox layout. This is the engine
// generateFacturaPDF (lib/pdf.ts) dispatches to by default; the pdf-lib
// implementation stays available as generateFacturaPDFLegacy behind
// REMITO_PDF_ENGINE=pdflib.
import * as React from "react"
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib"
import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "./currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "./timezone"
import type { FacturaPDFData } from "./pdf"

// === Monochrome tokens — copied 1:1 from lib/pdf-style.ts's MONO/TYPE ===
const MONO = {
  ink: "#111111",
  label: "#555555",
  faint: "#999999",
  rule: "#cccccc",
  totalBg: "#f2f2f2",
}

const TYPE = {
  docNumber: 18,
  docTitle: 10,
  sectionLabel: 6.5,
  body: 9,
  small: 8,
  fine: 6.5,
  total: 12,
}

const RULE_WIDTH = 0.5

const estadoPagoLabels: Record<string, string> = {
  PENDIENTE: "PENDIENTE",
  PAGADO_PARCIAL: "PAGO PARCIAL",
  PAGADO: "PAGADO",
  ANULADA: "ANULADA",
}

const metodoPagoFacturaLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Debito",
  TARJETA_CREDITO: "Tarjeta Credito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

const safe = (val: unknown): string => {
  if (val === null || val === undefined) return ""
  if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
  if (typeof val === "number") return String(val)
  return ""
}

// === LOGO ===
// Ported from generateFacturaPDFLegacy's LOGO block (lib/pdf.ts): fetch
// data.logoUrl, sniff the format from content-type (falling back to the
// URL's extension), embed the bytes. The fetch is guarded exactly like
// legacy's try/catch — a failed fetch (network error, non-OK response,
// unrecognized format) degrades to "no logo" and never rejects, so a broken
// logoUrl can never kill remito generation. Unlike legacy, we do NOT decode
// pixel dimensions here: the component reserves a FIXED box
// (LOGO_BOX_WIDTH x LOGO_BOX_HEIGHT below) and lets react-pdf's own
// objectFit:"contain" preserve the image's aspect ratio inside it, so the
// left-zone offset the clamp budget depends on is a known constant instead
// of varying per image.
export type RemitoLogo = { data: Buffer; format: "png" | "jpg" }

async function fetchLogo(logoUrl: string | null | undefined): Promise<RemitoLogo | null> {
  if (!logoUrl) return null
  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get("content-type") || ""
    const lowerUrl = logoUrl.toLowerCase()
    if (contentType.includes("png") || lowerUrl.includes(".png")) return { data: bytes, format: "png" }
    if (contentType.includes("jpeg") || contentType.includes("jpg") || lowerUrl.includes(".jpg") || lowerUrl.includes(".jpeg")) {
      return { data: bytes, format: "jpg" }
    }
    return null
  } catch (logoError) {
    console.error("Error loading logo:", logoError)
    return null
  }
}

// === Left-zone truncation clamp (letter box vs. header text) ===
// Ported from generateFacturaPDFLegacy's clampLeftZoneText (lib/pdf.ts).
// pdf-lib's StandardFonts give us the same Helvetica/Helvetica-Bold glyph
// metrics react-pdf itself renders with, so widths measured here match the
// actual rendered text.
let helvCache: { regular: PDFFont; bold: PDFFont } | null = null
async function helveticaMetrics() {
  if (!helvCache) {
    const doc = await PDFDocument.create()
    helvCache = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    }
  }
  return helvCache
}

function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 0 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

// Logo box — matches legacy's max ~50pt tall / ~80pt wide proportions
// (generateFacturaPDFLegacy's `maxLogoHeight`/`maxLogoWidth`), fixed rather
// than scaled per-image (see the LOGO comment above). LOGO_GAP mirrors
// legacy's "+15" gap between the logo and the company text
// (`logoWidth = scaledWidth + 15`).
const LOGO_BOX_WIDTH = 80
const LOGO_BOX_HEIGHT = 50
const LOGO_GAP = 15

// Left-zone x-origin and truncation budget. Mirrors legacy's
// `leftX = frameLeft + innerPad + logoWidth` and
// `leftZoneMaxWidth = letterBoxX - 10 - leftX` (lib/pdf.ts), but derived
// from THIS component's own layout instead of legacy's pdf-lib coordinates:
//   - LEFT_ZONE_X: styles.page.paddingLeft (40) + styles.frameInner.padding
//     (10) — the left zone's content starts right after the frame's own
//     padding, same as legacy's frameLeft(=margin) + innerPad.
//   - LETTER_BOX_X: the letter box (styles.letterBox, width 34) is centered
//     on the full A4 page width (595.28pt — @react-pdf/layout's
//     PAGE_SIZES.A4[0]) via letterBoxWrap's alignItems:'center' over a
//     left:0/right:0 span — same value as legacy's
//     `(width - letterBoxWidth) / 2` because both frames sit on symmetric
//     40pt page margins.
//   - LETTER_BOX_GAP: the 10pt clearance legacy's clampLeftZoneText leaves
//     before the letter box.
// Budget shrinks by LOGO_BOX_WIDTH + LOGO_GAP when a logo is present,
// because the left zone's text column is pushed right by that much (see
// styles.leftZoneLogo below).
const PAGE_WIDTH_A4 = 595.28
const LEFT_ZONE_X = 40 + 10
const LETTER_BOX_X = PAGE_WIDTH_A4 / 2 - 34 / 2
const LETTER_BOX_GAP = 10

// === Styles ===
// PAINT POINT #1 (letter-box straddle): the classic remito's letter box (X)
// straddles the outer frame's top border — half above, half below. In
// pdf-lib this is one absolute rectangle at a hardcoded y. In react-pdf we
// get it via position:'absolute' + a negative `top` on a child of the frame
// itself (not the padded content wrapper) — actually LESS code than
// pdf-lib's version, since we don't need to separately compute frameTop: the
// offset is relative to the frame's own border, guaranteed aligned by flex
// flow. Centering is `alignItems:'center'` on a full-width wrapper instead
// of pdf-lib's manual `(width - letterBoxWidth) / 2` text-width math — a
// genuine win.
const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingLeft: 40,
    paddingRight: 40,
    // Reserves footer clearance the same way pdf-lib's floorY constant
    // does, but for free: react-pdf just won't flow content into padding.
    paddingBottom: 75,
    fontFamily: "Helvetica",
    fontSize: TYPE.body,
    color: MONO.ink,
  },
  frame: {
    borderWidth: RULE_WIDTH,
    borderColor: MONO.ink,
    position: "relative", // anchor for the straddling letter box below
  },
  frameInner: { padding: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  leftZone: { flex: 1, paddingRight: 4, flexDirection: "row", alignItems: "flex-start" },
  // Fixed reservation (Task 4 LOGO_BOX_WIDTH/HEIGHT/GAP) — objectFit
  // "contain" keeps the actual image's own aspect ratio inside this box
  // without react needing to know its pixel dimensions up front.
  leftZoneLogo: { width: LOGO_BOX_WIDTH, height: LOGO_BOX_HEIGHT, marginRight: LOGO_GAP, objectFit: "contain" },
  leftZoneText: { flexDirection: "column" },
  centerGutter: { width: 180 }, // reserves room under the letter box/legend
  rightZone: { alignItems: "flex-end" },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body },
  smallLabel: { fontSize: TYPE.small, color: MONO.label, marginTop: 2 },
  smallLabelInk: { fontSize: TYPE.small, color: MONO.label, marginTop: 2, textAlign: "right" },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docTitle },
  docNumber: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docNumber, marginTop: 2 },
  letterBoxWrap: {
    position: "absolute",
    top: -15,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  letterBox: {
    width: 34,
    height: 30,
    borderWidth: RULE_WIDTH,
    borderColor: MONO.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  letterBoxText: { fontFamily: "Helvetica-Bold", fontSize: 20 },
  legendWrap: { position: "absolute", top: 21, left: 0, right: 0, alignItems: "center" },
  legendText: { fontSize: TYPE.fine, color: MONO.label },
  hr: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  sectionLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.sectionLabel, color: MONO.label, textTransform: "uppercase" },
  clienteBand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, paddingBottom: 6 },
  clienteLeft: { flex: 1, paddingRight: 4 },
  clienteRight: { alignItems: "flex-end" },
  clienteNombre: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginTop: 3 },
  condicionesBand: { paddingTop: 6, paddingBottom: 6 },
  condicionesRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, marginTop: 3, marginBottom: 5 },
  condicionesLine: { fontSize: TYPE.small, marginTop: 2 },

  tableSection: { marginTop: 14 },
  tableFrame: { borderWidth: RULE_WIDTH, borderColor: MONO.ink, marginTop: 8 },
  itemsHeaderRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink, paddingVertical: 5 },
  itemsRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 4 },
  colCant: { width: 45, paddingLeft: 8, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colDesc: { width: 260, paddingLeft: 8, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colPrecio: { width: 105, paddingRight: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small, textAlign: "right" },
  colSubtotal: { width: 105, paddingRight: 6, fontSize: TYPE.small, textAlign: "right" },
  headerCellLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.small, color: MONO.label },

  pagosHeaderRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink, paddingVertical: 5 },
  pagosRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 4 },
  colFecha: { width: 80, paddingLeft: 8, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colMetodo: { width: 85, paddingLeft: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colRef: { width: 130, paddingLeft: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colMonto: { width: 90, paddingRight: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  colSaldo: { flex: 1, paddingRight: 6, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  pagoNote: { fontSize: TYPE.fine, color: MONO.label, marginTop: 2 },

  detalleBlock: { marginTop: 8 },
  detalleRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 3 },
  detalleLabel: { fontSize: TYPE.body, color: MONO.label },
  detalleValue: { fontSize: TYPE.body },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 3 },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoBar: { flexDirection: "row", justifyContent: "space-between", backgroundColor: MONO.totalBg, paddingVertical: 6, paddingHorizontal: 10, marginTop: 4 },
  saldoLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoValue: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },

  estadoBlock: { marginTop: 10 },
  estadoRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  badge: { borderWidth: 0.75, borderColor: MONO.ink, paddingHorizontal: 5, paddingVertical: 3.5 },
  badgeText: { fontFamily: "Helvetica-Bold", fontSize: 7 },
  estadoMonto: { fontSize: TYPE.body, marginLeft: 20 },
  estadoPendiente: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginLeft: 20 },

  recibiBlock: { marginTop: 10 },
  sigRow: { flexDirection: "row", marginTop: 16 },
  sigCol: { flex: 1, marginRight: 20 },
  sigLine: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink },
  sigCaption: { fontSize: TYPE.fine, color: MONO.label, marginTop: 4 },

  continuationTitle: { position: "absolute", top: 14, left: 40, fontFamily: "Helvetica-Bold", fontSize: TYPE.docTitle },

  footer: { position: "absolute", bottom: 40, left: 40, right: 40 },
  footerRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  footerDisclaimer: { fontSize: TYPE.fine, color: MONO.faint, marginTop: 8 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  footerFine: { fontSize: 7, color: MONO.faint },
  footerPageNum: { fontSize: TYPE.small, color: MONO.faint },
})

export function RemitoDocument({
  data,
  logo = null,
  metrics,
}: {
  data: FacturaPDFData
  logo?: RemitoLogo | null
  metrics: { regular: PDFFont; bold: PDFFont }
}) {
  const currency = (data.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE
  const fmt = (n: number | null | undefined) => formatCurrencyValue(n, currency)
  const fmtDate = (d: Date | string | null | undefined) => formatDateValue(d, tz)

  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const cuitEmpresa = safe(data.cuitEmpresa)
  const condicionIvaEmpresa = safe(data.condicionIvaEmpresa)
  const domicilioFiscalEmpresa = safe(data.domicilioFiscalEmpresa)
  const ingresosBrutosEmpresa = safe(data.ingresosBrutosEmpresa)
  const inicioActividadesEmpresa = safe(data.inicioActividadesEmpresa)
  const numeroFactura = safe(data.numeroFactura)
  const fecha = fmtDate(data.fecha)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const clienteDireccion = safe(data.cliente?.direccion)
  const clienteDni = safe(data.cliente?.dni)
  const ordenDisplay = data.orden ? data.orden.codigoOrden || `#${String(data.orden.numeroOrden).padStart(4, "0")}` : ""
  const dispositivo = data.orden ? safe(data.orden.dispositivo) : ""
  const pendiente = data.total - (data.montoAbonado || 0)
  const vencimientoText = data.vencimiento ? fmtDate(data.vencimiento) : ""
  const mediosPago = safe(data.mediosPago)
  const cbuAlias = safe(data.cbuAlias)
  const hasCondiciones = Boolean(vencimientoText || mediosPago || cbuAlias)
  const saldo = Math.max(0, pendiente)
  const saldoLabel = saldo === 0 ? "SALDO" : "SALDO PENDIENTE"
  const estadoLabel = estadoPagoLabels[data.estadoPago] || data.estadoPago
  const fechaImpresion = formatDateTimeValue(new Date(), tz)

  // Left-zone truncation clamp (Task 4) — see the LEFT_ZONE_X/LETTER_BOX_X/
  // LOGO_* constants above for the budget derivation. Company name uses
  // bold metrics (matches styles.companyName's Helvetica-Bold), the
  // tel/dirección/domicilio lines use regular metrics (styles.smallLabel).
  const leftZoneX = LEFT_ZONE_X + (logo ? LOGO_BOX_WIDTH + LOGO_GAP : 0)
  const leftZoneMaxWidth = LETTER_BOX_X - LETTER_BOX_GAP - leftZoneX
  const empresaNombreDisplay = truncateToWidth(metrics.bold, empresaNombre, TYPE.body, leftZoneMaxWidth)
  const telefonoDisplay = telefonoEmpresa
    ? truncateToWidth(metrics.regular, `Tel: ${telefonoEmpresa}`, TYPE.small, leftZoneMaxWidth)
    : ""
  const direccionDisplay = direccionEmpresa
    ? truncateToWidth(metrics.regular, direccionEmpresa, TYPE.small, leftZoneMaxWidth)
    : ""
  const domicilioDisplay =
    domicilioFiscalEmpresa && domicilioFiscalEmpresa !== direccionEmpresa
      ? truncateToWidth(metrics.regular, domicilioFiscalEmpresa, TYPE.small, leftZoneMaxWidth)
      : ""

  // Running saldo for the HISTORIAL DE PAGOS column — plain data prep, same
  // cost in either engine (not a layout concern).
  let saldoCorrido = data.total
  const pagosWithSaldo = (data.pagos || []).map((p) => {
    saldoCorrido -= p.monto
    return { ...p, saldoCorrido }
  })

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* PAIN POINT: `fixed` is document-global, not scoped to a
            sub-table's own page span (see remito.tsx header comment above
            and the spike report) — so the continuation title is safe to
            mark fixed+gated by pageNumber (it's meant to show on every page
            after the first, document-wide), but the same trick can NOT be
            used for the items/pagos table headers without also leaking
            them onto unrelated pages. */}
        <Text
          fixed
          style={styles.continuationTitle}
          render={({ pageNumber }) => (pageNumber > 1 ? `REMITO ${numeroFactura} — continuación` : "")}
        />

        <View style={styles.frame} wrap={false}>
          <View style={styles.frameInner}>
            <View style={styles.headerRow}>
              <View style={styles.leftZone}>
                {logo ? (
                  <Image style={styles.leftZoneLogo} src={{ data: logo.data, format: logo.format }} />
                ) : null}
                <View style={styles.leftZoneText}>
                  <Text style={styles.companyName}>{empresaNombreDisplay}</Text>
                  {telefonoDisplay ? <Text style={styles.smallLabel}>{telefonoDisplay}</Text> : null}
                  {direccionDisplay ? <Text style={styles.smallLabel}>{direccionDisplay}</Text> : null}
                  {domicilioDisplay ? <Text style={styles.smallLabel}>{domicilioDisplay}</Text> : null}
                </View>
              </View>
              <View style={styles.centerGutter} />
              <View style={styles.rightZone}>
                <Text style={styles.docTitle}>REMITO</Text>
                <Text style={styles.docNumber}>{numeroFactura}</Text>
                <Text style={styles.smallLabelInk}>Emisión: {fecha}</Text>
                {data.fechaOperacion ? <Text style={styles.smallLabelInk}>Operación: {fmtDate(data.fechaOperacion)}</Text> : null}
                {cuitEmpresa ? <Text style={styles.smallLabelInk}>CUIT: {cuitEmpresa}</Text> : null}
                {ingresosBrutosEmpresa ? <Text style={styles.smallLabelInk}>Ingresos brutos: {ingresosBrutosEmpresa}</Text> : null}
                {inicioActividadesEmpresa ? <Text style={styles.smallLabelInk}>Inicio actividades: {inicioActividadesEmpresa}</Text> : null}
                {condicionIvaEmpresa ? <Text style={styles.smallLabelInk}>{condicionIvaEmpresa.toUpperCase()}</Text> : null}
              </View>
            </View>

            <View style={[styles.hr, { marginTop: 10 }]} />

            <View style={styles.clienteBand}>
              <View style={styles.clienteLeft}>
                <Text style={styles.sectionLabel}>CLIENTE</Text>
                <Text style={styles.clienteNombre}>{clienteNombre}</Text>
                {clienteDireccion ? <Text style={styles.smallLabel}>{clienteDireccion.substring(0, 40)}</Text> : null}
                {clienteTelefono ? <Text style={styles.smallLabel}>Tel: {clienteTelefono}</Text> : null}
                {clienteEmail ? <Text style={styles.smallLabel}>{clienteEmail}</Text> : null}
              </View>
              <View style={styles.clienteRight}>
                {clienteDni ? <Text style={styles.smallLabelInk}>CUIT/DNI: {clienteDni}</Text> : null}
                <Text style={[styles.detalleValue, { marginTop: 4 }]}>
                  {data.venta ? `VENTA: V${String(data.venta.numeroVenta).padStart(4, "0")}` : `ORDEN: ${ordenDisplay}${dispositivo ? ` — ${dispositivo}` : ""}`}
                </Text>
              </View>
            </View>

            {hasCondiciones ? (
              <>
                <View style={styles.hr} />
                <View style={styles.condicionesBand}>
                  <Text style={styles.sectionLabel}>Condiciones de pago</Text>
                  <View style={styles.condicionesRule} />
                  {vencimientoText ? <Text style={styles.condicionesLine}>Vencimiento: {vencimientoText}</Text> : null}
                  {mediosPago ? <Text style={styles.condicionesLine}>Medios de pago: {mediosPago}</Text> : null}
                  {cbuAlias ? <Text style={styles.condicionesLine}>CBU/Alias: {cbuAlias}</Text> : null}
                </View>
              </>
            ) : null}
          </View>

          {/* Letter box + legend: absolute, straddling the frame's own top
              border — direct children of `frame`, not `frameInner`, so
              the -15 offset is relative to the actual bordered edge. */}
          <View style={styles.letterBoxWrap}>
            <View style={styles.letterBox}>
              <Text style={styles.letterBoxText}>X</Text>
            </View>
          </View>
          <View style={styles.legendWrap}>
            <Text style={styles.legendText}>Documento no válido como comprobante fiscal</Text>
          </View>
        </View>

        {/* === DETALLE DE ITEMS === */}
        {data.items && data.items.length > 0 ? (
          <View style={styles.tableSection}>
            <Text style={styles.sectionLabel}>DETALLE DE ITEMS</Text>
            <View style={styles.tableFrame}>
              <View style={styles.itemsHeaderRow} fixed>
                <Text style={[styles.colCant, styles.headerCellLabel]}>CANT.</Text>
                <Text style={[styles.colDesc, styles.headerCellLabel]}>DESCRIPCIÓN</Text>
                <Text style={[styles.colPrecio, styles.headerCellLabel]}>PRECIO</Text>
                <Text style={[styles.colSubtotal, styles.headerCellLabel]}>SUBTOTAL</Text>
              </View>
              {data.items.map((item, i) => (
                <View key={i} style={styles.itemsRow} wrap={false}>
                  <Text style={styles.colCant}>{item.cantidad}</Text>
                  <Text style={styles.colDesc}>{safe(item.descripcion).substring(0, 40)}</Text>
                  <Text style={styles.colPrecio}>{fmt(item.precioUnitario)}</Text>
                  <Text style={styles.colSubtotal}>{fmt(item.subtotal)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* === DETALLE (money block) + ESTADO DE PAGO — kept together via
            wrap={false}, the declarative analog of pdf-lib's manual
            totalsBlockH pre-flight check. === */}
        <View style={styles.detalleBlock} wrap={false}>
          <Text style={styles.sectionLabel}>DETALLE</Text>
          <View style={[styles.hr, { marginTop: 4, marginBottom: 8 }]} />

          <View style={styles.detalleRow}>
            <Text style={styles.detalleLabel}>Subtotal</Text>
            <Text style={styles.detalleValue}>{fmt(data.subtotal)}</Text>
          </View>
          {data.iva > 0 ? (
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>IVA</Text>
              <Text style={styles.detalleValue}>{fmt(data.iva)}</Text>
            </View>
          ) : null}
          {data.descuento && data.descuento > 0 ? (
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Descuento</Text>
              <Text style={styles.detalleValue}>-{fmt(data.descuento)}</Text>
            </View>
          ) : null}
          {data.redondeo && data.redondeo !== 0 ? (
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Redondeo</Text>
              <Text style={styles.detalleValue}>
                {data.redondeo >= 0 ? "+" : ""}
                {fmt(data.redondeo)}
              </Text>
            </View>
          ) : null}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{fmt(data.total)}</Text>
          </View>
          <View style={styles.detalleRow}>
            <Text style={styles.detalleLabel}>Pagado a cuenta</Text>
            <Text style={styles.detalleValue}>{fmt(data.montoAbonado)}</Text>
          </View>
          <View style={styles.saldoBar}>
            <Text style={styles.saldoLabel}>{saldoLabel}</Text>
            <Text style={styles.saldoValue}>{fmt(saldo)}</Text>
          </View>

          <View style={styles.estadoBlock}>
            <Text style={styles.sectionLabel}>ESTADO DE PAGO</Text>
            <View style={[styles.hr, { marginTop: 4 }]} />
            <View style={styles.estadoRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{estadoLabel}</Text>
              </View>
              <Text style={styles.estadoMonto}>Abonado: {fmt(data.montoAbonado)}</Text>
              {pendiente > 0 && data.estadoPago !== "ANULADA" ? (
                <Text style={styles.estadoPendiente}>Pendiente: {fmt(pendiente)}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* === HISTORIAL DE PAGOS === */}
        {pagosWithSaldo.length > 0 ? (
          <View style={styles.tableSection}>
            <Text style={styles.sectionLabel}>HISTORIAL DE PAGOS</Text>
            <View style={styles.tableFrame}>
              <View style={styles.pagosHeaderRow} fixed>
                <Text style={[styles.colFecha, styles.headerCellLabel]}>FECHA</Text>
                <Text style={[styles.colMetodo, styles.headerCellLabel]}>MÉTODO</Text>
                <Text style={[styles.colRef, styles.headerCellLabel]}>REFERENCIA</Text>
                <Text style={[styles.colMonto, styles.headerCellLabel]}>MONTO</Text>
                <Text style={[styles.colSaldo, styles.headerCellLabel]}>SALDO</Text>
              </View>
              {pagosWithSaldo.map((pago, i) => {
                const noteParts: string[] = []
                if (pago.cuotas && pago.cuotas > 1) noteParts.push(`${pago.cuotas} cuotas`)
                if (pago.recargoPorcentaje && pago.recargoPorcentaje > 0) noteParts.push(`${pago.recargoPorcentaje}% recargo`)
                const note = noteParts.join(" · ")
                return (
                  <View key={i} style={styles.pagosRow} wrap={false}>
                    <View style={styles.colFecha}>
                      <Text>{fmtDate(pago.fecha)}</Text>
                    </View>
                    <View style={styles.colMetodo}>
                      <Text>{metodoPagoFacturaLabels[pago.metodoPago] || pago.metodoPago}</Text>
                    </View>
                    <View style={styles.colRef}>
                      <Text>{safe(pago.referencia).substring(0, 16)}</Text>
                      {note ? <Text style={styles.pagoNote}>{note}</Text> : null}
                    </View>
                    <Text style={styles.colMonto}>{fmt(pago.monto)}</Text>
                    <Text style={styles.colSaldo}>{fmt(pago.saldoCorrido)}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        ) : null}

        {/* === RECIBÍ CONFORME (orden-sourced only) === */}
        {data.orden ? (
          <View style={styles.recibiBlock} wrap={false}>
            <Text style={styles.sectionLabel}>Recibí conforme</Text>
            <View style={[styles.hr, { marginTop: 4 }]} />
            <View style={styles.sigRow}>
              <View style={styles.sigCol}>
                <View style={styles.sigLine} />
                <Text style={styles.sigCaption}>Firma</Text>
              </View>
              <View style={styles.sigCol}>
                <View style={styles.sigLine} />
                <Text style={styles.sigCaption}>Aclaración</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* === FOOTER — fixed, repeats on every page for free. === */}
        <View style={styles.footer} fixed>
          <View style={styles.footerRule} />
          <Text style={styles.footerDisclaimer}>Remito interno — no válido como comprobante fiscal.</Text>
          <View style={styles.footerRow}>
            <Text style={styles.footerFine}>Impreso: {fechaImpresion}</Text>
            <Text
              style={styles.footerPageNum}
              render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : "")}
            />
          </View>
        </View>
      </Page>
    </Document>
  )
}

export async function generateFacturaPDFReact(data: FacturaPDFData): Promise<Buffer> {
  const [metrics, logo] = await Promise.all([helveticaMetrics(), fetchLogo(data.logoUrl)])
  return renderToBuffer(<RemitoDocument data={data} logo={logo} metrics={metrics} />)
}
