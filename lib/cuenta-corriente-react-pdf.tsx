// react-pdf engine for cuenta corriente receipts. Same monochrome house
// style as the remito (lib/remito-react-pdf.tsx), sharing its tokens, logo
// fetching and text metrics via lib/pdf-react-shared.ts — but NOT its frame
// geometry: a recibo carries no fiscal letter box and no centered legend, so
// its header has a single left/right split and a wider left zone. Those
// constants are derived below from this document's own composition.
import * as React from "react"
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "./currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "./timezone"
import {
  MONO,
  TYPE,
  RULE_WIDTH,
  PAGE_WIDTH_A4,
  safe,
  fetchLogo,
  helveticaMetrics,
  truncateToWidth,
  type PdfLogo,
  type HelveticaMetrics,
} from "./pdf-react-shared"

/** Emisor + cliente identity, shared by every cuenta corriente document. */
export interface CuentaCorrienteEmisor {
  cliente: {
    nombre?: string | null
    dni?: string | null
    telefono?: string | null
    email?: string | null
    direccion?: string | null
  }
  nombreEmpresa?: string | null
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  cuitEmpresa?: string | null
  condicionIvaEmpresa?: string | null
  domicilioFiscalEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string | null
  zonaHoraria?: string | null
  sucursalNombre?: string | null
  atendidoPor?: string | null
}

export interface ReciboCCPDFData extends CuentaCorrienteEmisor {
  /** Display number, already formatted by the caller (e.g. "REC-00007"). */
  numeroRecibo: string
  fecha: Date | string
  /** cuenta_corriente.tipo — DEPOSITO | PAGO | DEVOLUCION | AJUSTE | CARGO | USO. */
  tipo: string
  /**
   * cuenta_corriente.monto, signed exactly as stored (migrations 066 + 234):
   * positive = haber (DEPOSITO/PAGO/DEVOLUCION), negative = debe (CARGO/USO).
   * The receipt prints its absolute value as the amount received and uses
   * the sign only to derive the previous balance.
   */
  monto: number
  /** cuenta_corriente.saldo_posterior — negative means the client still owes. */
  saldoPosterior: number
  metodoPago?: string | null
  numeroReferencia?: string | null
  observaciones?: string | null
}

/** One row of the account statement, as cuenta_corriente stores it. */
export interface ResumenCCMovimiento {
  fecha: Date | string
  tipo: string
  /** Signed: negative = debe (CARGO/USO), positive = haber. */
  monto: number
  /** Running balance the movement left behind — never recomputed here. */
  saldoPosterior: number
  metodoPago?: string | null
  numeroReferencia?: string | null
  referenciaTipo?: string | null
}

export interface ResumenCCPDFData extends CuentaCorrienteEmisor {
  desde: Date | string
  hasta: Date | string
  /** Balance the account carried into the period (0 when it had no history). */
  saldoInicial: number
  saldoFinal: number
  /** Oldest first — the statement reads top-down. */
  movimientos: ResumenCCMovimiento[]
}

const conceptoLabels: Record<string, string> = {
  DEPOSITO: "Depósito en cuenta corriente",
  PAGO: "Pago de cuenta corriente",
  DEVOLUCION: "Devolución a cuenta corriente",
  AJUSTE: "Ajuste de cuenta corriente",
  CARGO: "Cargo a cuenta corriente",
  USO: "Uso de saldo en cuenta corriente",
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

// Logo box — same reservation as the remito's, so both documents line their
// headers up when an org prints them side by side.
const LOGO_BOX_WIDTH = 80
const LOGO_BOX_HEIGHT = 50
const LOGO_GAP = 15

// Left-zone truncation budget. Unlike the remito, nothing sits in the middle
// of this header, so the only competitor for horizontal space is the right
// zone itself:
//   - LEFT_ZONE_X: styles.page.paddingLeft (40) + styles.frameInner.padding (10).
//   - CONTENT_WIDTH: the A4 page minus both 40pt margins, minus the frame's
//     own border on each side, minus frameInner's padding on each side.
//   - RIGHT_ZONE_WIDTH: styles.rightZone's fixed width, sized for the widest
//     line it can hold ("Inicio actividades"-class labels are not printed on
//     a recibo, so CUIT + condición IVA is the ceiling).
// Budget shrinks by LOGO_BOX_WIDTH + LOGO_GAP when a logo is present, since
// the text column is pushed right by exactly that much.
const LEFT_ZONE_X = 40 + 10
const RIGHT_ZONE_WIDTH = 190
const HEADER_GAP = 14
const CONTENT_WIDTH = PAGE_WIDTH_A4 - 40 - 40 - RULE_WIDTH * 2 - 10 * 2
const LEFT_ZONE_BUDGET = CONTENT_WIDTH - RIGHT_ZONE_WIDTH - HEADER_GAP

const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingLeft: 40,
    paddingRight: 40,
    // Reserves footer clearance — react-pdf won't flow content into padding.
    paddingBottom: 75,
    fontFamily: "Helvetica",
    fontSize: TYPE.body,
    color: MONO.ink,
  },
  frame: { borderWidth: RULE_WIDTH, borderColor: MONO.ink },
  frameInner: { padding: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  leftZone: { flex: 1, paddingRight: HEADER_GAP, flexDirection: "row", alignItems: "flex-start" },
  leftZoneLogo: { width: LOGO_BOX_WIDTH, height: LOGO_BOX_HEIGHT, marginRight: LOGO_GAP, objectFit: "contain" },
  leftZoneText: { flexDirection: "column" },
  rightZone: { width: RIGHT_ZONE_WIDTH, alignItems: "flex-end" },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body },
  smallLabel: { fontSize: TYPE.small, color: MONO.label, marginTop: 2 },
  smallLabelRight: { fontSize: TYPE.small, color: MONO.label, marginTop: 2, textAlign: "right" },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docTitle },
  docNumber: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docNumber, marginTop: 2 },

  hr: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: TYPE.sectionLabel,
    color: MONO.label,
    textTransform: "uppercase",
  },
  clienteBand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
  clienteLeft: { flex: 1, paddingRight: 8 },
  clienteRight: { alignItems: "flex-end" },
  clienteNombre: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginTop: 3 },

  detalleSection: { marginTop: 14 },
  detalleBlock: { marginTop: 8 },
  detalleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.rule,
    paddingVertical: 3,
  },
  detalleLabel: { fontSize: TYPE.body, color: MONO.label },
  detalleValue: { fontSize: TYPE.body, textAlign: "right" },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.rule,
    paddingVertical: 5,
    marginTop: 6,
  },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: MONO.totalBg,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  saldoLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoValue: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoNote: { fontSize: TYPE.fine, color: MONO.label, marginTop: 4 },

  obsBlock: { marginTop: 12 },
  obsText: { fontSize: TYPE.small, marginTop: 4 },

  recibiBlock: { marginTop: 18 },
  sigRow: { flexDirection: "row", marginTop: 22 },
  sigCol: { flex: 1, marginRight: 20 },
  sigLine: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink },
  sigCaption: { fontSize: TYPE.fine, color: MONO.label, marginTop: 4 },

  // === Statement table ===
  // Widths are absolute so the header cells and the data cells cannot drift
  // apart. They sum to the table frame's inner width, with CONCEPTO taking
  // whatever is left over (flex: 1).
  tablaSection: { marginTop: 14 },
  tablaFrame: { borderWidth: RULE_WIDTH, borderColor: MONO.ink, marginTop: 8 },
  tablaHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.ink,
    backgroundColor: MONO.totalBg,
    paddingVertical: 5,
  },
  tablaRow: {
    flexDirection: "row",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.rule,
    paddingVertical: 4,
  },
  colFecha: {
    width: 58,
    paddingLeft: 6,
    borderRightWidth: RULE_WIDTH,
    borderRightColor: MONO.ink,
    fontSize: TYPE.small,
  },
  colConcepto: {
    flex: 1,
    paddingLeft: 6,
    paddingRight: 4,
    borderRightWidth: RULE_WIDTH,
    borderRightColor: MONO.ink,
    fontSize: TYPE.small,
  },
  colComprobante: {
    width: 86,
    paddingLeft: 6,
    paddingRight: 4,
    borderRightWidth: RULE_WIDTH,
    borderRightColor: MONO.ink,
    fontSize: TYPE.small,
  },
  colDebe: {
    width: 68,
    paddingRight: 6,
    borderRightWidth: RULE_WIDTH,
    borderRightColor: MONO.ink,
    fontSize: TYPE.small,
    textAlign: "right",
  },
  colHaber: {
    width: 68,
    paddingRight: 6,
    borderRightWidth: RULE_WIDTH,
    borderRightColor: MONO.ink,
    fontSize: TYPE.small,
    textAlign: "right",
  },
  colSaldo: { width: 74, paddingRight: 6, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  headerCellLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.small, color: MONO.label },
  conceptoNote: { fontSize: TYPE.fine, color: MONO.label, marginTop: 1 },
  totalesRow: { flexDirection: "row", borderTopWidth: RULE_WIDTH, borderTopColor: MONO.ink, paddingVertical: 5 },
  totalesLabel: { flex: 1, paddingLeft: 6, fontSize: TYPE.small, fontFamily: "Helvetica-Bold" },
  totalesCell: { width: 68, paddingRight: 6, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  totalesSaldo: { width: 74, paddingRight: 6, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  vacio: { paddingVertical: 20, textAlign: "center", fontSize: TYPE.small, color: MONO.label },

  footer: { position: "absolute", bottom: 40, left: 40, right: 40 },
  footerRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  footerDisclaimer: { fontSize: TYPE.fine, color: MONO.faint, marginTop: 8 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  footerFine: { fontSize: 7, color: MONO.faint },
  footerPageNum: { fontSize: TYPE.small, color: MONO.faint },
})

/**
 * Emisor + cliente frame shared by both cuenta corriente documents. The right
 * zone renders whatever identity lines the document wants under its title, so
 * a recibo shows its number and a resumen shows its period, without either
 * one owning the emisor block.
 */
function CabeceraCC({
  data,
  logo,
  metrics,
  titulo,
  numero,
  lineasDerecha = [],
  clienteLabel,
}: {
  data: CuentaCorrienteEmisor
  logo: PdfLogo | null
  metrics: HelveticaMetrics
  titulo: string
  numero?: string
  lineasDerecha?: string[]
  clienteLabel: string
}) {
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const domicilioFiscalEmpresa = safe(data.domicilioFiscalEmpresa)
  const cuitEmpresa = safe(data.cuitEmpresa)
  const condicionIvaEmpresa = safe(data.condicionIvaEmpresa)

  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteDni = safe(data.cliente?.dni)
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const clienteDireccion = safe(data.cliente?.direccion)
  const sucursalNombre = safe(data.sucursalNombre)
  const atendidoPor = safe(data.atendidoPor)

  // Header clamp — see LEFT_ZONE_BUDGET above. The company name measures
  // against bold metrics (styles.companyName), the rest against regular
  // (styles.smallLabel).
  const leftBudget = LEFT_ZONE_BUDGET - (logo ? LOGO_BOX_WIDTH + LOGO_GAP : 0)
  const clamp = (text: string, bold = false) =>
    truncateToWidth(bold ? metrics.bold : metrics.regular, text, bold ? TYPE.body : TYPE.small, leftBudget)

  const telefonoDisplay = telefonoEmpresa ? clamp(`Tel: ${telefonoEmpresa}`) : ""
  const direccionDisplay = direccionEmpresa ? clamp(direccionEmpresa) : ""
  const domicilioDisplay =
    domicilioFiscalEmpresa && domicilioFiscalEmpresa !== direccionEmpresa ? clamp(domicilioFiscalEmpresa) : ""

  return (
    <View style={styles.frame}>
      <View style={styles.frameInner}>
        <View style={styles.headerRow}>
          <View style={styles.leftZone}>
            {logo ? <Image style={styles.leftZoneLogo} src={{ data: logo.data, format: logo.format }} /> : null}
            <View style={styles.leftZoneText}>
              <Text style={styles.companyName}>{clamp(empresaNombre, true)}</Text>
              {telefonoDisplay ? <Text style={styles.smallLabel}>{telefonoDisplay}</Text> : null}
              {direccionDisplay ? <Text style={styles.smallLabel}>{direccionDisplay}</Text> : null}
              {domicilioDisplay ? <Text style={styles.smallLabel}>{domicilioDisplay}</Text> : null}
            </View>
          </View>
          <View style={styles.rightZone}>
            <Text style={styles.docTitle}>{titulo}</Text>
            {numero ? <Text style={styles.docNumber}>{numero}</Text> : null}
            {lineasDerecha.map((linea, i) => (
              <Text key={i} style={styles.smallLabelRight}>
                {linea}
              </Text>
            ))}
            {cuitEmpresa ? <Text style={styles.smallLabelRight}>CUIT: {cuitEmpresa}</Text> : null}
            {condicionIvaEmpresa ? (
              <Text style={styles.smallLabelRight}>{condicionIvaEmpresa.toUpperCase()}</Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.hr, { marginTop: 10 }]} />

        <View style={styles.clienteBand}>
          <View style={styles.clienteLeft}>
            <Text style={styles.sectionLabel}>{clienteLabel}</Text>
            <Text style={styles.clienteNombre}>{clienteNombre}</Text>
            {clienteDni ? <Text style={styles.smallLabel}>DNI/CUIT: {clienteDni}</Text> : null}
            {clienteTelefono ? <Text style={styles.smallLabel}>Tel: {clienteTelefono}</Text> : null}
            {clienteEmail ? <Text style={styles.smallLabel}>{clienteEmail}</Text> : null}
            {clienteDireccion ? <Text style={styles.smallLabel}>{clienteDireccion}</Text> : null}
          </View>
          {sucursalNombre || atendidoPor ? (
            <View style={styles.clienteRight}>
              {sucursalNombre ? (
                <>
                  <Text style={styles.sectionLabel}>Sucursal</Text>
                  <Text style={styles.smallLabelRight}>{sucursalNombre}</Text>
                </>
              ) : null}
              {atendidoPor ? <Text style={styles.smallLabelRight}>Atendió: {atendidoPor}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

/**
 * Closing-balance headline. A negative saldo means the client owes, so the
 * direction is spelled out and the figure printed in absolute value — a bare
 * "-$3.000" on a customer-facing document reads like a credit.
 */
function saldoHeadline(saldo: number): { label: string; valor: number } {
  return {
    label: saldo > 0 ? "SALDO A FAVOR" : saldo < 0 ? "SALDO ADEUDADO" : "SALDO",
    valor: Math.abs(saldo),
  }
}

function PieCC({ leyenda, fechaImpresion }: { leyenda: string; fechaImpresion: string }) {
  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerRule} />
      <Text style={styles.footerDisclaimer}>{leyenda}</Text>
      <View style={styles.footerRow}>
        <Text style={styles.footerFine}>Impreso: {fechaImpresion}</Text>
        <Text
          style={styles.footerPageNum}
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : "")}
        />
      </View>
    </View>
  )
}

export function ReciboCCDocument({
  data,
  logo = null,
  metrics,
}: {
  data: ReciboCCPDFData
  logo?: PdfLogo | null
  metrics: HelveticaMetrics
}) {
  const currency = (data.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE
  const fmt = (n: number) => formatCurrencyValue(n, currency)

  const concepto = conceptoLabels[data.tipo] || data.tipo
  const metodoPago = data.metodoPago ? metodoPagoLabels[data.metodoPago] || data.metodoPago : ""
  const referencia = safe(data.numeroReferencia)
  const observaciones = safe(data.observaciones)

  // The stored row already answers both halves of the movement: how much
  // moved (monto, signed) and where the account landed (saldo_posterior).
  // The opening balance is therefore exact arithmetic, never a re-derivation
  // over the movement history.
  const importe = Math.abs(data.monto)
  const saldoAnterior = data.saldoPosterior - data.monto
  const { label: saldoLabel, valor: saldoValor } = saldoHeadline(data.saldoPosterior)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CabeceraCC
          data={data}
          logo={logo}
          metrics={metrics}
          titulo="RECIBO"
          numero={safe(data.numeroRecibo)}
          lineasDerecha={[`Fecha: ${formatDateValue(data.fecha, tz)}`]}
          clienteLabel="Recibimos de"
        />

        <View style={styles.detalleSection}>
          <Text style={styles.sectionLabel}>Detalle del movimiento</Text>
          <View style={styles.detalleBlock}>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Concepto</Text>
              <Text style={styles.detalleValue}>{concepto}</Text>
            </View>
            {metodoPago ? (
              <View style={styles.detalleRow}>
                <Text style={styles.detalleLabel}>Método de pago</Text>
                <Text style={styles.detalleValue}>{metodoPago}</Text>
              </View>
            ) : null}
            {referencia ? (
              <View style={styles.detalleRow}>
                <Text style={styles.detalleLabel}>Referencia</Text>
                <Text style={styles.detalleValue}>{referencia}</Text>
              </View>
            ) : null}
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Fecha del movimiento</Text>
              <Text style={styles.detalleValue}>{formatDateTimeValue(data.fecha, tz)}</Text>
            </View>
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>IMPORTE RECIBIDO</Text>
            <Text style={styles.totalValue}>{fmt(importe)}</Text>
          </View>

          <View style={styles.detalleRow}>
            <Text style={styles.detalleLabel}>Saldo anterior</Text>
            <Text style={styles.detalleValue}>{fmt(saldoAnterior)}</Text>
          </View>

          <View style={styles.saldoBar}>
            <Text style={styles.saldoLabel}>{saldoLabel}</Text>
            <Text style={styles.saldoValue}>{fmt(saldoValor)}</Text>
          </View>
          <Text style={styles.saldoNote}>
            Saldo de la cuenta corriente del cliente posterior a este movimiento.
          </Text>
        </View>

        {observaciones ? (
          <View style={styles.obsBlock}>
            <Text style={styles.sectionLabel}>Observaciones</Text>
            <View style={[styles.hr, { marginTop: 4 }]} />
            <Text style={styles.obsText}>{observaciones}</Text>
          </View>
        ) : null}

        <View style={styles.recibiBlock}>
          <Text style={styles.sectionLabel}>Conformidad</Text>
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

        <PieCC
          leyenda="Recibo interno de cuenta corriente — no válido como comprobante fiscal."
          fechaImpresion={formatDateTimeValue(new Date(), tz)}
        />
      </Page>
    </Document>
  )
}

export async function generateReciboCCPDF(data: ReciboCCPDFData): Promise<Buffer> {
  const [metrics, logo] = await Promise.all([helveticaMetrics(), fetchLogo(data.logoUrl)])
  return renderToBuffer(<ReciboCCDocument data={data} logo={logo} metrics={metrics} />)
}

/**
 * Account statement for a date range.
 *
 * Every balance it prints is read, never recomputed: each row already carries
 * the saldo_posterior the movement left behind, and saldoInicial/saldoFinal
 * come from the caller (which reads the movement immediately before the
 * range — see the resumen route). Re-deriving a running balance here would
 * silently diverge from the ledger the rest of the app trusts.
 */
export function ResumenCCDocument({
  data,
  logo = null,
  metrics,
}: {
  data: ResumenCCPDFData
  logo?: PdfLogo | null
  metrics: HelveticaMetrics
}) {
  const currency = (data.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE
  const fmt = (n: number) => formatCurrencyValue(n, currency)

  const desde = formatDateValue(data.desde, tz)
  const hasta = formatDateValue(data.hasta, tz)
  const movimientos = data.movimientos || []

  const totalDebe = movimientos.reduce((acc, m) => (m.monto < 0 ? acc + Math.abs(m.monto) : acc), 0)
  const totalHaber = movimientos.reduce((acc, m) => (m.monto > 0 ? acc + m.monto : acc), 0)
  const { label: saldoLabel, valor: saldoValor } = saldoHeadline(data.saldoFinal)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CabeceraCC
          data={data}
          logo={logo}
          metrics={metrics}
          titulo="RESUMEN DE CUENTA"
          lineasDerecha={[`Período: ${desde} — ${hasta}`]}
          clienteLabel="Cliente"
        />

        <View style={styles.tablaSection}>
          <Text style={styles.sectionLabel}>Movimientos del período</Text>

          <View style={styles.detalleBlock}>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Saldo inicial al {desde}</Text>
              <Text style={styles.detalleValue}>{fmt(data.saldoInicial)}</Text>
            </View>
          </View>

          {movimientos.length === 0 ? (
            <Text style={styles.vacio}>Sin movimientos en el período.</Text>
          ) : (
            <View style={styles.tablaFrame}>
              {/* `fixed` repeats this row at the top of every page. Safe here
                  in a way it is not on the remito: this table is the
                  document's only body block, so there is no later section a
                  document-global repeat could leak onto. */}
              <View style={styles.tablaHeaderRow} fixed>
                <Text style={[styles.colFecha, styles.headerCellLabel]}>FECHA</Text>
                <Text style={[styles.colConcepto, styles.headerCellLabel]}>CONCEPTO</Text>
                <Text style={[styles.colComprobante, styles.headerCellLabel]}>COMPROBANTE</Text>
                <Text style={[styles.colDebe, styles.headerCellLabel]}>DEBE</Text>
                <Text style={[styles.colHaber, styles.headerCellLabel]}>HABER</Text>
                <Text style={[styles.colSaldo, styles.headerCellLabel]}>SALDO</Text>
              </View>

              {movimientos.map((mov, i) => {
                const metodo = mov.metodoPago ? metodoPagoLabels[mov.metodoPago] || mov.metodoPago : ""
                const comprobante = safe(mov.numeroReferencia) || safe(mov.referenciaTipo)
                return (
                  <View key={i} style={styles.tablaRow} wrap={false}>
                    <Text style={styles.colFecha}>{formatDateValue(mov.fecha, tz)}</Text>
                    <View style={styles.colConcepto}>
                      <Text>{conceptoLabels[mov.tipo] || mov.tipo}</Text>
                      {metodo ? <Text style={styles.conceptoNote}>{metodo}</Text> : null}
                    </View>
                    <Text style={styles.colComprobante}>{comprobante}</Text>
                    <Text style={styles.colDebe}>{mov.monto < 0 ? fmt(Math.abs(mov.monto)) : ""}</Text>
                    <Text style={styles.colHaber}>{mov.monto > 0 ? fmt(mov.monto) : ""}</Text>
                    <Text style={styles.colSaldo}>{fmt(mov.saldoPosterior)}</Text>
                  </View>
                )
              })}

              <View style={styles.totalesRow} wrap={false}>
                <Text style={styles.totalesLabel}>Totales del período</Text>
                <Text style={styles.totalesCell}>{fmt(totalDebe)}</Text>
                <Text style={styles.totalesCell}>{fmt(totalHaber)}</Text>
                <Text style={styles.totalesSaldo}>{fmt(data.saldoFinal)}</Text>
              </View>
            </View>
          )}

          <View style={styles.saldoBar} wrap={false}>
            <Text style={styles.saldoLabel}>{saldoLabel}</Text>
            <Text style={styles.saldoValue}>{fmt(saldoValor)}</Text>
          </View>
          <Text style={styles.saldoNote}>Saldo de la cuenta corriente al {hasta}.</Text>
        </View>

        <PieCC
          leyenda="Resumen interno de cuenta corriente — no válido como comprobante fiscal."
          fechaImpresion={formatDateTimeValue(new Date(), tz)}
        />
      </Page>
    </Document>
  )
}

export async function generateResumenCCPDF(data: ResumenCCPDFData): Promise<Buffer> {
  const [metrics, logo] = await Promise.all([helveticaMetrics(), fetchLogo(data.logoUrl)])
  return renderToBuffer(<ResumenCCDocument data={data} logo={logo} metrics={metrics} />)
}
