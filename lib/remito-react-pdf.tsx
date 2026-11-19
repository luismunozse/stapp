// react-pdf remito engine — seeded from the spike component
// (spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx). Renders the
// classic remito via @react-pdf/renderer flexbox layout. This is the engine
// generateFacturaPDF (lib/pdf.ts) dispatches to by default; the pdf-lib
// implementation stays available as generateFacturaPDFLegacy behind
// REMITO_PDF_ENGINE=pdflib.
import * as React from "react"
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { type PDFFont } from "pdf-lib"
import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "./currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "./timezone"
// Monochrome tokens, logo fetching and Helvetica text measurement are shared
// with the other react-pdf engines — see lib/pdf-react-shared.ts. The frame,
// the header and the cliente band — including this document's letter box,
// centered legend and the clamps derived from them — live in
// lib/pdf-react-shell.tsx, which draws them for every A4 document.
import { MONO, TYPE, RULE_WIDTH, safe, fetchLogo, helveticaMetrics, type PdfLogo } from "./pdf-react-shared"
import {
  Pie,
  leyendaPie,
  estilosShell,
  FilaDetalle,
  BarraTotal,
  Badge,
  Cabecera,
  BandaCliente,
  Firmas,
  Tabla,
  type ColumnaTabla,
} from "./pdf-react-shell"
import type { FacturaPDFData } from "./pdf"

/**
 * This document's two tables. `sangriaIzquierda: 8` on CANT., DESCRIPCIÓN and
 * the pagos FECHA is the remito's own pre-existing inset — the shell's default
 * is 6, which every other column here already used. It is stated per column
 * rather than folded into the shared default because the two are a genuine
 * 2pt difference in where the text starts, not a rounding artefact.
 */
const COLUMNAS_ITEMS: ColumnaTabla[] = [
  { key: "cantidad", titulo: "CANT.", ancho: 45, sangriaIzquierda: 8 },
  { key: "descripcion", titulo: "DESCRIPCIÓN", ancho: 260, sangriaIzquierda: 8 },
  { key: "precio", titulo: "PRECIO", ancho: 105, alinear: "right" },
  { key: "subtotal", titulo: "SUBTOTAL", ancho: 105, alinear: "right" },
]

const COLUMNAS_PAGOS: ColumnaTabla[] = [
  { key: "fecha", titulo: "FECHA", ancho: 80, sangriaIzquierda: 8 },
  { key: "metodo", titulo: "MÉTODO", ancho: 85 },
  { key: "referencia", titulo: "REFERENCIA", ancho: 130 },
  { key: "monto", titulo: "MONTO", ancho: 90, alinear: "right", bold: true },
  { key: "saldo", titulo: "SALDO", flex: true, alinear: "right", bold: true },
]

/** Row padding for both tables: the shell's 4pt reads cramped without column rules. */
const TABLA_FILA = 6

const estadoPagoLabels: Record<string, string> = {
  PENDIENTE: "PENDIENTE",
  PAGADO_PARCIAL: "PAGO PARCIAL",
  PAGADO: "PAGADO",
  ANULADA: "ANULADA",
}

const metodoPagoFacturaLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta débito",
  TARJETA_CREDITO: "Tarjeta crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

// === Styles ===
// The frame, the letter box, the centered legend, the header zones and the
// cliente band are all drawn by lib/pdf-react-shell.tsx now. Their geometry
// constants (LOGO_BOX_*, LEFT_ZONE_X, LETTER_BOX_*, the legend-row
// measurements) and the derivations documenting them moved there with the
// code: this document selects the letter-box branch by passing
// `letterBox="X"` to <Cabecera>. Everything below is the remito's own body.
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
  // `hr` and `sectionLabel` are byte-identical to estilosShell.hr /
  // estilosShell.sectionLabel — deliberately kept local rather than imported,
  // and <Seccion> is deliberately not used for this document's six section
  // headings. <Seccion> wraps its body in `seccionBody` (marginTop: 8) on top
  // of this document's own spacing (e.g. <Tabla>'s own `marginTop: 8`),
  // which would double up and move the output. Reuse the values, not the
  // wrapper.
  hr: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  sectionLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.sectionLabel, color: MONO.label, textTransform: "uppercase" },
  condicionesBand: { paddingTop: 6, paddingBottom: 6 },
  condicionesRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, marginTop: 3, marginBottom: 5 },
  condicionesLine: { fontSize: TYPE.small, marginTop: 2 },

  // The table frames, header bands, row rules and column cells are drawn by
  // <Tabla> (lib/pdf-react-shell.tsx); this document only declares its own
  // columns (COLUMNAS_ITEMS / COLUMNAS_PAGOS below) and asks for the grey
  // header band, no vertical separators and roomier rows (TABLA_FILA).
  tableSection: { marginTop: 14 },
  pagoNote: { fontSize: TYPE.fine, color: MONO.label, marginTop: 2 },

  // Cliente band, right column: the VENTA/ORDEN reference, styled like the
  // CLIENTE column it faces (label, bold code, detail line under it).
  referenciaLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.sectionLabel, color: MONO.label, textTransform: "uppercase", textAlign: "right" },
  referenciaCodigo: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginTop: 3, textAlign: "right" },

  // Totals: one compact invoice-style block on the right half of the page.
  totalesBlock: { marginTop: 14, flexDirection: "row", justifyContent: "flex-end" },
  totalesCol: { width: "50%" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: RULE_WIDTH,
    borderTopColor: MONO.ink,
    paddingVertical: 4,
  },
  // 10pt bold: one step over the 9pt body rows and one under the 12pt saldo
  // bar, which stays the protagonist.
  totalTexto: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  estadoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },

  continuationTitle: { position: "absolute", top: 14, left: 40, fontFamily: "Helvetica-Bold", fontSize: TYPE.docTitle },
})

export function RemitoDocument({
  data,
  logo = null,
  metrics,
}: {
  data: FacturaPDFData
  logo?: PdfLogo | null
  metrics: { regular: PDFFont; bold: PDFFont }
}) {
  const currency = (data.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE
  const fmt = (n: number | null | undefined) => formatCurrencyValue(n, currency)
  const fmtDate = (d: Date | string | null | undefined) => formatDateValue(d, tz)

  const numeroFactura = safe(data.numeroFactura)
  const fecha = fmtDate(data.fecha)
  const clienteDireccion = safe(data.cliente?.direccion)
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
        {/* `fixed` on a DIRECT child of Page is document-global: this title
            shows on every page, so it gates itself on pageNumber.
            It is NOT document-global further down the tree, contrary to what
            this comment used to claim (a spike-era belief the code itself
            never followed — both table headers have shipped `fixed` since
            this engine landed). @react-pdf/layout's splitNodes pushes a fixed
            child into both the current and the next copy of ITS OWN parent,
            so a table header repeats only across the pages that table spans
            and stops when the frame stops splitting. That is what
            <Tabla headerFijo> relies on below, and dropping it measurably
            deletes the header row from page 2 of a 60-item remito. */}
        <Text
          fixed
          style={styles.continuationTitle}
          render={({ pageNumber }) => (pageNumber > 1 ? `REMITO ${numeroFactura} — continuación` : "")}
        />

        <Cabecera
          emisor={data}
          logo={logo}
          metrics={metrics}
          // The right zone carries ingresos brutos and inicio de actividades
          // on top of CUIT/IVA, so it sizes to its content: pinning it starves
          // the left zone and shrinks the reserved logo box.
          zonaDerecha="auto"
          titulo="REMITO"
          numero={numeroFactura}
          lineasDerecha={[
            `Emisión: ${fecha}`,
            ...(data.fechaOperacion ? [`Operación: ${fmtDate(data.fechaOperacion)}`] : []),
          ]}
          letterBox="X"
          cajaInterior
          wrap={false}
        >
          {/* Two mirrored columns: CLIENTE (name, then its ID and contact
              lines) on the left, the VENTA/ORDEN reference on the right with
              the same label → bold value → detail rhythm, so both labels sit
              on the same baseline. The ID keeps the remito's "CUIT/DNI" order. */}
          <BandaCliente
            label="Cliente"
            cliente={{ ...data.cliente, direccion: clienteDireccion.substring(0, 40) }}
            campos={["dni", "direccion", "telefono", "email"]}
            pais={data.pais}
            ordenEtiquetaId="fiscal-primero"
            espacioInferior={6}
            espacioDerecha={4}
            derecha={
              data.venta ? (
                <>
                  <Text style={styles.referenciaLabel}>Venta</Text>
                  <Text style={styles.referenciaCodigo}>V{String(data.venta.numeroVenta).padStart(4, "0")}</Text>
                </>
              ) : data.orden ? (
                <>
                  <Text style={styles.referenciaLabel}>Orden</Text>
                  <Text style={styles.referenciaCodigo}>{ordenDisplay}</Text>
                  {dispositivo ? <Text style={estilosShell.smallLabelRight}>{dispositivo}</Text> : null}
                </>
              ) : null
            }
          />

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
        </Cabecera>

        {/* === DETALLE DE ITEMS === */}
        {data.items && data.items.length > 0 ? (
          <View style={styles.tableSection}>
            <Text style={styles.sectionLabel}>DETALLE DE ITEMS</Text>
            <Tabla
              columnas={COLUMNAS_ITEMS}
              headerFijo
              headerSombreado
              separadoresVerticales={false}
              espacioFila={TABLA_FILA}
              filas={data.items.map((item) => ({
                cantidad: String(item.cantidad),
                descripcion: safe(item.descripcion).substring(0, 40),
                precio: fmt(item.precioUnitario),
                subtotal: fmt(item.subtotal),
              }))}
            />
          </View>
        ) : null}

        {/* === TOTALES — one invoice-style block on the right half: the
            breakdown, TOTAL, what was paid, the estado badge (shown once) and
            the saldo bar. Kept together via wrap={false}, the declarative
            analog of pdf-lib's manual totalsBlockH pre-flight check. === */}
        <View style={styles.totalesBlock} wrap={false}>
          <View style={styles.totalesCol}>
            <FilaDetalle label="Subtotal" valor={fmt(data.subtotal)} />
            {data.iva > 0 ? <FilaDetalle label="IVA" valor={fmt(data.iva)} /> : null}
            {data.descuento && data.descuento > 0 ? (
              <FilaDetalle label="Descuento" valor={`-${fmt(data.descuento)}`} />
            ) : null}
            {data.redondeo && data.redondeo !== 0 ? (
              <FilaDetalle
                label="Redondeo"
                valor={`${data.redondeo >= 0 ? "+" : ""}${fmt(data.redondeo)}`}
              />
            ) : null}

            <View style={styles.totalRow}>
              <Text style={styles.totalTexto}>TOTAL</Text>
              <Text style={styles.totalTexto}>{fmt(data.total)}</Text>
            </View>
            <FilaDetalle label="Pagado a cuenta" valor={fmt(data.montoAbonado)} />

            <View style={styles.estadoRow}>
              <Text style={estilosShell.filaLabel}>Estado</Text>
              <Badge texto={estadoLabel} />
            </View>
            <BarraTotal label={saldoLabel} valor={fmt(saldo)} />
          </View>
        </View>

        {/* === HISTORIAL DE PAGOS === */}
        {pagosWithSaldo.length > 0 ? (
          <View style={styles.tableSection}>
            <Text style={styles.sectionLabel}>HISTORIAL DE PAGOS</Text>
            <Tabla
              columnas={COLUMNAS_PAGOS}
              headerFijo
              headerSombreado
              separadoresVerticales={false}
              espacioFila={TABLA_FILA}
              filas={pagosWithSaldo.map((pago) => {
                const noteParts: string[] = []
                if (pago.cuotas && pago.cuotas > 1) noteParts.push(`${pago.cuotas} cuotas`)
                if (pago.recargoPorcentaje && pago.recargoPorcentaje > 0) noteParts.push(`${pago.recargoPorcentaje}% recargo`)
                const note = noteParts.join(" · ")
                return {
                  fecha: fmtDate(pago.fecha),
                  metodo: metodoPagoFacturaLabels[pago.metodoPago] || pago.metodoPago,
                  // The note line under the reference is why Tabla's `filas`
                  // accepts an element, not just a plain string.
                  referencia: (
                    <>
                      <Text>{safe(pago.referencia).substring(0, 16)}</Text>
                      {note ? <Text style={styles.pagoNote}>{note}</Text> : null}
                    </>
                  ),
                  monto: fmt(pago.monto),
                  saldo: fmt(pago.saldoCorrido),
                }
              })}
            />
          </View>
        ) : null}

        {/* === RECIBÍ CONFORME (orden-sourced only) === */}
        {data.orden ? (
          // espacioSuperior/espacioFilas: 14 matches every other section gap
          // on this document (tableSection, totalesBlock); 22 leaves room to
          // actually sign (it was 10/16). Required on Firmas, not defaulted,
          // so this call site states them explicitly.
          <Firmas
            titulo="Recibí conforme"
            campos={["Firma", "Aclaración"]}
            espacioSuperior={14}
            espacioFilas={22}
          />
        ) : null}

        {/* === FOOTER — fixed, repeats on every page for free. === */}
        <Pie leyenda={leyendaPie("Remito interno")} fechaImpresion={fechaImpresion} />
      </Page>
    </Document>
  )
}

export async function generateFacturaPDFReact(data: FacturaPDFData): Promise<Buffer> {
  const [metrics, logo] = await Promise.all([helveticaMetrics(), fetchLogo(data.logoUrl)])
  return renderToBuffer(<RemitoDocument data={data} logo={logo} metrics={metrics} />)
}
