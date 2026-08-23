// react-pdf engine for cuenta corriente receipts. Same monochrome house
// style as the remito (lib/remito-react-pdf.tsx), sharing its tokens, logo
// fetching and text metrics via lib/pdf-react-shared.ts and its header,
// cliente band and structural pieces via lib/pdf-react-shell.tsx. These
// documents carry no fiscal letter box and no centered legend, so they draw
// the shell's plain two-zone header — the branch Cabecera takes when no
// `letterBox` is passed.
import * as React from "react"
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "./currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "./timezone"
import {
  MONO,
  TYPE,
  RULE_WIDTH,
  safe,
  fetchLogo,
  helveticaMetrics,
  type PdfLogo,
  type HelveticaMetrics,
} from "./pdf-react-shared"
import {
  Pie,
  leyendaPie,
  estilosShell,
  Seccion,
  FilaDetalle,
  BarraTotal,
  Cabecera,
  BandaCliente,
  Firmas,
  type DocumentoBase,
} from "./pdf-react-shell"

export interface ReciboCCPDFData extends DocumentoBase {
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

export interface ResumenCCPDFData extends DocumentoBase {
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
  saldoNote: { fontSize: TYPE.fine, color: MONO.label, marginTop: 4 },

  obsBlock: { marginTop: 12 },
  obsText: { fontSize: TYPE.small, marginTop: 4 },

  // === Statement table ===
  // Widths are absolute so the header cells and the data cells cannot drift
  // apart. They sum to the table frame's inner width, with CONCEPTO taking
  // whatever is left over (flex: 1).
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
})

/**
 * What both cuenta corriente documents pin to the right of the cliente band:
 * where the movement was taken and by whom.
 *
 * Deliberately a plain function, NOT a component, and called as
 * `derechaSucursal(data)` rather than rendered as `<DerechaSucursal />`: it
 * must be able to return `undefined` so BandaCliente's `derecha ? ... : null`
 * sees a falsy slot and skips the column entirely. A component always
 * produces a truthy element, which would draw an empty right column on every
 * document that sets neither field.
 */
function derechaSucursal(data: DocumentoBase): React.ReactNode {
  const sucursalNombre = safe(data.sucursalNombre)
  const atendidoPor = safe(data.atendidoPor)
  if (!sucursalNombre && !atendidoPor) return undefined

  return (
    <>
      {sucursalNombre ? (
        <>
          <Text style={estilosShell.sectionLabel}>Sucursal</Text>
          <Text style={estilosShell.smallLabelRight}>{sucursalNombre}</Text>
        </>
      ) : null}
      {atendidoPor ? <Text style={estilosShell.smallLabelRight}>Atendió: {atendidoPor}</Text> : null}
    </>
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
        <Cabecera
          emisor={data}
          logo={logo}
          metrics={metrics}
          zonaDerecha="fija"
          titulo="RECIBO"
          // `|| undefined` keeps a blank número collapsing the row entirely,
          // as it always has here — Cabecera reserves the row for "" so a
          // document that always prints a number never shifts.
          numero={safe(data.numeroRecibo) || undefined}
          lineasDerecha={[`Fecha: ${formatDateValue(data.fecha, tz)}`]}
        >
          <BandaCliente
            label="Recibimos de"
            cliente={data.cliente}
            espacioDerecha={8}
            derecha={derechaSucursal(data)}
          />
        </Cabecera>

        <Seccion titulo="Detalle del movimiento">
          <FilaDetalle label="Concepto" valor={concepto} />
          {metodoPago ? <FilaDetalle label="Método de pago" valor={metodoPago} /> : null}
          {referencia ? <FilaDetalle label="Referencia" valor={referencia} /> : null}
          <FilaDetalle label="Fecha del movimiento" valor={formatDateTimeValue(data.fecha, tz)} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>IMPORTE RECIBIDO</Text>
            <Text style={styles.totalValue}>{fmt(importe)}</Text>
          </View>

          <FilaDetalle label="Saldo anterior" valor={fmt(saldoAnterior)} />

          <BarraTotal label={saldoLabel} valor={fmt(saldoValor)} />
          <Text style={styles.saldoNote}>
            Saldo de la cuenta corriente del cliente posterior a este movimiento.
          </Text>
        </Seccion>

        {observaciones ? (
          <View style={styles.obsBlock}>
            <Text style={estilosShell.sectionLabel}>Observaciones</Text>
            <View style={[estilosShell.hr, { marginTop: 4 }]} />
            <Text style={styles.obsText}>{observaciones}</Text>
          </View>
        ) : null}

        <Firmas titulo="Conformidad" campos={["Firma", "Aclaración"]} />

        <Pie
          leyenda={leyendaPie("Recibo interno de cuenta corriente")}
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
        <Cabecera
          emisor={data}
          logo={logo}
          metrics={metrics}
          zonaDerecha="fija"
          titulo="RESUMEN DE CUENTA"
          lineasDerecha={[`Período: ${desde} — ${hasta}`]}
        >
          <BandaCliente
            label="Cliente"
            cliente={data.cliente}
            espacioDerecha={8}
            derecha={derechaSucursal(data)}
          />
        </Cabecera>

        <Seccion titulo="Movimientos del período">
          <FilaDetalle label={`Saldo inicial al ${desde}`} valor={fmt(data.saldoInicial)} />

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

          <BarraTotal label={saldoLabel} valor={fmt(saldoValor)} />
          <Text style={styles.saldoNote}>Saldo de la cuenta corriente al {hasta}.</Text>
        </Seccion>

        <Pie
          leyenda={leyendaPie("Resumen interno de cuenta corriente")}
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
