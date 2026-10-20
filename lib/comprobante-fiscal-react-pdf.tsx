// react-pdf engine for the ARCA fiscal comprobante (Factura B / C).
//
// Built ONLY from the persisted comprobante columns plus the organization's
// fiscal data -- never from the venta, which can be edited after emission.
// Same monochrome A4 house style as the remito, with the straddling letter
// box carrying the ARCA code ("COD. 006") instead of the not-fiscal legend.
//
// Footer follows the ARCA spec: QR, "Comprobante Autorizado", CAE N°, CAE
// expiry date and the Administration's disclaimer. Text only: the ARCA logo
// image is not shipped.
import * as React from "react"
import QRCode from "qrcode"
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { formatCurrencyValue } from "./currency"
import { MONO, TYPE, safe, fetchLogo, helveticaMetrics, type PdfLogo, type HelveticaMetrics } from "./pdf-react-shared"
import {
  Cabecera,
  BandaCliente,
  Tabla,
  FilaDetalle,
  BarraTotal,
  estilosShell,
  type ColumnaTabla,
  type EmisorData,
} from "./pdf-react-shell"
import { datosQrDesdeComprobante, urlQrArca, pdfFiscalDisponible, type ComprobanteQrRow } from "./facturacion/arca/qr"
import { lineasComprobante } from "./facturacion/comprobante-lineas"

/** The persisted `comprobantes_fiscales` columns this document reads. */
export interface ComprobanteFiscalRow extends ComprobanteQrRow {
  tipo?: string | null
  cae_vencimiento?: string | null
  concepto?: number | null
  importe_neto?: number | string | null
  importe_iva?: number | string | null
  detalle?: unknown
}

/** Legacy row (pre-snapshot) or otherwise unable to produce a valid QR. Routes map it to 409. */
export class ComprobanteIncompletoError extends Error {
  constructor() {
    super("Comprobante con datos incompletos")
    this.name = "ComprobanteIncompletoError"
  }
}

const LEYENDA_ARCA =
  "Esta Administración Federal no se responsabiliza por la veracidad de los datos ingresados en el detalle de la operación"

const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingLeft: 40,
    paddingRight: 40,
    // Reserves clearance for the ARCA footer (QR 80pt + margins).
    paddingBottom: 150,
    fontFamily: "Helvetica",
    fontSize: TYPE.body,
    color: MONO.ink,
  },
  nota: { fontSize: TYPE.small, color: MONO.label, marginTop: 4 },
  pie: { position: "absolute", bottom: 40, left: 40, right: 40 },
  pieRegla: { borderBottomWidth: 0.5, borderBottomColor: MONO.rule, marginBottom: 8 },
  pieFila: { flexDirection: "row" },
  pieQr: { width: 80, height: 80, marginRight: 14 },
  pieTexto: { flex: 1 },
  pieAutorizado: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  pieDato: { fontSize: TYPE.body, marginTop: 3 },
  pieDescargo: { fontSize: TYPE.fine, color: MONO.faint, marginTop: 5 },
})

const COLUMNAS: ColumnaTabla[] = [
  { key: "descripcion", titulo: "DESCRIPCIÓN", flex: true, sangriaDerecha: 4 },
  { key: "cantidad", titulo: "CANT.", ancho: 44, alinear: "right" },
  { key: "unitario", titulo: "P. UNIT.", ancho: 84, alinear: "right" },
  { key: "importe", titulo: "IMPORTE", ancho: 84, alinear: "right", bold: true },
]

/** "2026-10-19" or "20261029" -> "19/10/2026". Pure string work: no timezone can shift a fiscal date. */
function fechaDMA(valor: string | null | undefined): string {
  const s = safe(valor)
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

export function ComprobanteFiscalDocument({
  comprobante,
  emisor,
  qrPng,
  logo = null,
  metrics,
}: {
  comprobante: ComprobanteFiscalRow
  emisor: EmisorData
  qrPng: Buffer
  logo?: PdfLogo | null
  metrics: HelveticaMetrics
}) {
  const letra: "B" | "C" = comprobante.tipo === "C" ? "C" : "B"
  const fmt = (n: number) => formatCurrencyValue(n, "ARS")
  const { lineas, ivaContenido, total } = lineasComprobante(comprobante.detalle, letra, {
    importeIva: Number(comprobante.importe_iva ?? 0),
    importeTotal: Number(comprobante.importe_total ?? 0),
  })
  const docNro = safe(comprobante.receptor_doc_nro_cod)
  const sinIdentificar = !docNro || /^0+$/.test(docNro)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Cabecera
          emisor={emisor}
          logo={logo}
          metrics={metrics}
          zonaDerecha="auto"
          titulo="FACTURA"
          numero={safe(comprobante.numero)}
          lineasDerecha={[`Fecha de emisión: ${fechaDMA(comprobante.fecha_emision)}`]}
          letterBox={letra}
          leyendaCaja={`COD. ${String(comprobante.cbte_tipo).padStart(3, "0")}`}
        >
          <BandaCliente
            label="Cliente"
            cliente={{ nombre: "Consumidor Final", dni: sinIdentificar ? null : docNro }}
            pais={emisor.pais}
            campos={["dni"]}
            espacioInferior={0}
            espacioDerecha={8}
          />
        </Cabecera>

        <Tabla
          columnas={COLUMNAS}
          headerFijo
          filas={lineas.map((l) => ({
            descripcion: safe(l.descripcion),
            cantidad: String(l.cantidad),
            unitario: fmt(l.unitario),
            importe: fmt(l.importe),
          }))}
        />

        <View style={estilosShell.seccion} wrap={false}>
          {ivaContenido !== null ? (
            <>
              <FilaDetalle label="IVA contenido" valor={fmt(ivaContenido)} />
              <Text style={styles.nota}>Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</Text>
            </>
          ) : null}
          <BarraTotal label="TOTAL" valor={fmt(total)} />
        </View>

        <View style={styles.pie} fixed>
          <View style={styles.pieRegla} />
          <View style={styles.pieFila}>
            <Image style={styles.pieQr} src={{ data: qrPng, format: "png" }} />
            <View style={styles.pieTexto}>
              <Text style={styles.pieAutorizado}>Comprobante Autorizado</Text>
              <Text style={styles.pieDato}>CAE N°: {safe(comprobante.cae)}</Text>
              <Text style={styles.pieDato}>Fecha de Vto. de CAE: {fechaDMA(comprobante.cae_vencimiento)}</Text>
              <Text style={styles.pieDescargo}>{LEYENDA_ARCA}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}

export async function generateComprobanteFiscalPDF({
  comprobante,
  emisor,
}: {
  comprobante: ComprobanteFiscalRow
  emisor: EmisorData
}): Promise<Buffer> {
  const datos = datosQrDesdeComprobante(comprobante)
  if (!datos || !pdfFiscalDisponible(comprobante)) throw new ComprobanteIncompletoError()

  const [metrics, logo, qrPng] = await Promise.all([
    helveticaMetrics(),
    fetchLogo(emisor.logoUrl),
    QRCode.toBuffer(urlQrArca(datos), { type: "png", margin: 1, width: 240, errorCorrectionLevel: "M" }),
  ])
  return renderToBuffer(
    <ComprobanteFiscalDocument comprobante={comprobante} emisor={emisor} qrPng={qrPng} logo={logo} metrics={metrics} />
  )
}
