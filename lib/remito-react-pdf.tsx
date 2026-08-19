// react-pdf remito engine — seeded from the spike component
// (spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx). Renders the
// classic remito via @react-pdf/renderer flexbox layout. This is the engine
// generateFacturaPDF (lib/pdf.ts) dispatches to by default; the pdf-lib
// implementation stays available as generateFacturaPDFLegacy behind
// REMITO_PDF_ENGINE=pdflib.
import * as React from "react"
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
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
    paddingTop: 40,
    paddingLeft: 40,
    paddingRight: 40,
    // Reserves footer clearance the same way pdf-lib's floorY constant
    // does, but for free: react-pdf just won't flow content into padding.
    paddingBottom: 90,
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
  leftZone: { flex: 1, paddingRight: 4 },
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
  clienteBand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, paddingBottom: 10 },
  clienteLeft: { flex: 1, paddingRight: 4 },
  clienteRight: { alignItems: "flex-end" },
  clienteNombre: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginTop: 4 },
  condicionesBand: { paddingTop: 10, paddingBottom: 10 },
  condicionesRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, marginTop: 4, marginBottom: 8 },
  condicionesLine: { fontSize: TYPE.small, marginTop: 2 },

  tableSection: { marginTop: 24 },
  tableFrame: { borderWidth: RULE_WIDTH, borderColor: MONO.ink, marginTop: 16 },
  itemsHeaderRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink, paddingVertical: 6 },
  itemsRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 5 },
  colCant: { width: 45, paddingLeft: 8, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colDesc: { width: 260, paddingLeft: 8, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colPrecio: { width: 105, paddingRight: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small, textAlign: "right" },
  colSubtotal: { width: 105, paddingRight: 6, fontSize: TYPE.small, textAlign: "right" },
  headerCellLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.small, color: MONO.label },

  pagosHeaderRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink, paddingVertical: 6 },
  pagosRow: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 5 },
  colFecha: { width: 80, paddingLeft: 8, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colMetodo: { width: 85, paddingLeft: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colRef: { width: 130, paddingLeft: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small },
  colMonto: { width: 90, paddingRight: 6, borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  colSaldo: { flex: 1, paddingRight: 6, fontSize: TYPE.small, textAlign: "right", fontFamily: "Helvetica-Bold" },
  pagoNote: { fontSize: TYPE.fine, color: MONO.label, marginTop: 2 },

  detalleBlock: { marginTop: 16 },
  detalleRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 4 },
  detalleLabel: { fontSize: TYPE.body, color: MONO.label },
  detalleValue: { fontSize: TYPE.body },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 4 },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoBar: { flexDirection: "row", justifyContent: "space-between", backgroundColor: MONO.totalBg, paddingVertical: 8, paddingHorizontal: 10, marginTop: 5 },
  saldoLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  saldoValue: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },

  estadoBlock: { marginTop: 20 },
  estadoRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  badge: { borderWidth: 0.75, borderColor: MONO.ink, paddingHorizontal: 5, paddingVertical: 3.5 },
  badgeText: { fontFamily: "Helvetica-Bold", fontSize: 7 },
  estadoMonto: { fontSize: TYPE.body, marginLeft: 20 },
  estadoPendiente: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginLeft: 20 },

  recibiBlock: { marginTop: 20 },
  sigRow: { flexDirection: "row", marginTop: 30 },
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

export function RemitoDocument({ data }: { data: FacturaPDFData }) {
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
                <Text style={styles.companyName}>{empresaNombre}</Text>
                {telefonoEmpresa ? <Text style={styles.smallLabel}>Tel: {telefonoEmpresa}</Text> : null}
                {direccionEmpresa ? <Text style={styles.smallLabel}>{direccionEmpresa}</Text> : null}
                {domicilioFiscalEmpresa && domicilioFiscalEmpresa !== direccionEmpresa ? (
                  <Text style={styles.smallLabel}>{domicilioFiscalEmpresa}</Text>
                ) : null}
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
  return renderToBuffer(<RemitoDocument data={data} />)
}
