// react-pdf engine for the nota de crédito. One document for both engines
// (devoluciones de venta and notas de crédito de orden) and for the DEV-
// history. Same monochrome house style as the recibo and the resumen
// (lib/cuenta-corriente-react-pdf.tsx), on the shell's plain two-zone header:
// no fiscal letter box, because this is not a fiscal document and the footer
// says so.
//
// Everything printed here is read by the end customer: wording speaks to them
// ("Te devolvimos", "tu saldo"), never in the system's own terms.
import * as React from "react"
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "./currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "./timezone"
import {
  MONO,
  TYPE,
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
  Tabla,
  type ColumnaTabla,
  type DocumentoBase,
} from "./pdf-react-shell"

export interface ItemNotaCreditoPDF {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
}

export interface NotaCreditoPDFData extends DocumentoBase {
  numero: string
  fecha: Date | string
  origen: "VENTA" | "ORDEN"
  /** Number of the source operation, already formatted ("V0042", "CEL099"). */
  operacion: string
  /** Reason to print: the catalog label, or the free text of a DEV- record. */
  motivo: string
  /** Free text entered with the credit note; printed only if it adds to `motivo`. */
  detalle?: string | null
  observaciones?: string | null
  /** Returned lines. Empty for a credit note by amount. */
  items: ItemNotaCreditoPDF[]
  monto: number
  montoAplicadoDeuda: number
  montoReembolso: number
  /** Refund line label, already worded for the customer (etiquetaReintegro). */
  etiquetaReintegro: string
  /**
   * The source operation's pending balance TODAY. Not stored per credit note,
   * so a reprint shows today's value next to today's date. null = not shown.
   */
  pendienteActual: number | null
  anulada?: boolean
  anuladaAt?: Date | string | null
  anuladaMotivo?: string | null
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
  nota: { fontSize: TYPE.small, color: MONO.label, marginTop: 4 },
  obsBlock: { marginTop: 12 },
  obsText: { fontSize: TYPE.small, marginTop: 4 },
  // Monochrome stamp, like the rest of the house style: weight and a frame
  // instead of red.
  sello: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: MONO.ink,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  selloTitulo: { fontFamily: "Helvetica-Bold", fontSize: 18 },
  selloTexto: { fontSize: TYPE.small, marginTop: 3, textAlign: "center" },
})

const COLUMNAS_ITEMS: ColumnaTabla[] = [
  { key: "descripcion", titulo: "DESCRIPCIÓN", flex: true, sangriaDerecha: 4 },
  { key: "cantidad", titulo: "CANT.", ancho: 44, alinear: "right" },
  { key: "unitario", titulo: "P. UNIT.", ancho: 84, alinear: "right" },
  { key: "subtotal", titulo: "SUBTOTAL", ancho: 84, alinear: "right", bold: true },
]

/**
 * Sucursal and operator, pinned to the right of the cliente band. A plain
 * function that may return undefined, so BandaCliente skips the column when
 * neither is set (same contract as lib/cuenta-corriente-react-pdf.tsx).
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

export function NotaCreditoDocument({
  data,
  logo = null,
  metrics,
}: {
  data: NotaCreditoPDFData
  logo?: PdfLogo | null
  metrics: HelveticaMetrics
}) {
  const currency = (data.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE
  const fmt = (n: number) => formatCurrencyValue(n, currency)
  const hoy = formatDateValue(new Date(), tz)
  const operacion = data.origen === "VENTA" ? "venta" : "orden"
  const motivo = safe(data.motivo)
  const detalle = safe(data.detalle)
  const observaciones = safe(data.observaciones)
  const motivoAnulacion = safe(data.anuladaMotivo)

  const textoAnulada =
    `Esta nota de crédito fue anulada${data.anuladaAt ? ` el ${formatDateValue(data.anuladaAt, tz)}` : ""} y ya no tiene efecto.` +
    (motivoAnulacion ? ` Motivo: ${motivoAnulacion}.` : "")

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Cabecera
          emisor={data}
          logo={logo}
          metrics={metrics}
          zonaDerecha="fija"
          titulo="NOTA DE CRÉDITO"
          numero={safe(data.numero)}
          lineasDerecha={[
            `Fecha: ${formatDateValue(data.fecha, tz)}`,
            `${data.origen === "VENTA" ? "Venta" : "Orden"}: ${safe(data.operacion)}`,
          ]}
        >
          <BandaCliente
            label="Cliente"
            cliente={data.cliente}
            pais={data.pais}
            campos={["dni", "telefono", "email", "direccion"]}
            espacioInferior={0}
            espacioDerecha={8}
            derecha={derechaSucursal(data)}
          />
        </Cabecera>

        {data.anulada ? (
          <View style={styles.sello} wrap={false}>
            <Text style={styles.selloTitulo}>ANULADA</Text>
            <Text style={styles.selloTexto}>{textoAnulada}</Text>
          </View>
        ) : null}

        <Seccion titulo="Detalle">
          <FilaDetalle label="Motivo" valor={motivo || "Sin motivo"} />
          {detalle && detalle !== motivo ? <Text style={styles.nota}>{detalle}</Text> : null}
        </Seccion>

        {data.items.length > 0 ? (
          <Seccion titulo="Productos devueltos">
            <Tabla
              columnas={COLUMNAS_ITEMS}
              headerFijo
              filas={data.items.map((item) => ({
                descripcion: safe(item.descripcion),
                cantidad: String(item.cantidad),
                unitario: fmt(item.precioUnitario),
                subtotal: fmt(item.subtotal),
              }))}
            />
          </Seccion>
        ) : null}

        <Seccion titulo="Importes">
          {data.montoAplicadoDeuda > 0 ? (
            <FilaDetalle label="Descontado de tu saldo pendiente" valor={fmt(data.montoAplicadoDeuda)} />
          ) : null}
          {data.montoReembolso > 0 ? (
            <FilaDetalle label={safe(data.etiquetaReintegro) || "Reintegro"} valor={fmt(data.montoReembolso)} />
          ) : null}
          <BarraTotal label="TOTAL ACREDITADO" valor={fmt(data.monto)} />
          {data.pendienteActual !== null ? (
            <Text style={styles.nota}>
              {data.pendienteActual > 0
                ? `Saldo pendiente de la ${operacion} al ${hoy}: ${fmt(data.pendienteActual)}.`
                : `Al ${hoy} la ${operacion} no tiene saldo pendiente.`}
            </Text>
          ) : null}
        </Seccion>

        {observaciones ? (
          <View style={styles.obsBlock}>
            <Text style={estilosShell.sectionLabel}>Observaciones</Text>
            <View style={[estilosShell.hr, { marginTop: 4 }]} />
            <Text style={styles.obsText}>{observaciones}</Text>
          </View>
        ) : null}

        <Pie
          leyenda={leyendaPie("Nota de crédito interna")}
          fechaImpresion={formatDateTimeValue(new Date(), tz)}
        />
      </Page>
    </Document>
  )
}

export async function generateNotaCreditoPDF(data: NotaCreditoPDFData): Promise<Buffer> {
  const [metrics, logo] = await Promise.all([helveticaMetrics(), fetchLogo(data.logoUrl)])
  return renderToBuffer(<NotaCreditoDocument data={data} logo={logo} metrics={metrics} />)
}
