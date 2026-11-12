// Informe técnico de una orden: el documento que el taller le manda al cliente
// (o guarda para un reclamo de garantía) con todo lo que se hizo. A diferencia
// del comprobante de la orden (lib/pdf.ts), que es UNA hoja fija, este fluye
// en las páginas que haga falta: diagnóstico completo, todos los avances
// visibles, el trabajo con importes y las fotos.
//
// Lo lee el cliente final: nada interno (notas internas, avances internos,
// fotos de diagnóstico o de componentes, costos de compra).
import * as React from "react"
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "./currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "./timezone"
import { MONO, TYPE, safe, fetchLogo, helveticaMetrics, type PdfLogo, type HelveticaMetrics } from "./pdf-react-shared"
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

export interface InformeTecnicoPDFData extends DocumentoBase {
  /** Código de la orden, ya formateado ("CEL0042"). */
  codigoOrden: string
  fechaIngreso: Date | string
  fechaEntrega?: Date | string | null
  /** Estado en palabras para el cliente ("Listo para retirar"). */
  estado: string
  equipo: {
    tipo?: string | null
    marca?: string | null
    modelo?: string | null
    color?: string | null
    /** "IMEI" o "N° de serie", según el tipo de equipo. */
    identificadorLabel?: string | null
    identificador?: string | null
  }
  falla: string
  diagnostico?: string | null
  tecnicoNombre?: string | null
  avances: Array<{ fecha: Date; texto: string }>
  trabajos: Array<{ nombre: string; cantidad: number; importe: number }>
  costoFinal?: number | null
  garantia?: { dias: number; fechaVencimiento: Date | string } | null
  fotos: Array<{ etiqueta: string; descripcion?: string | null; fecha: Date; jpeg: Buffer }>
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingLeft: 40,
    paddingRight: 40,
    paddingBottom: 75,
    fontFamily: "Helvetica",
    fontSize: TYPE.body,
    color: MONO.ink,
  },
  parrafo: { fontSize: TYPE.body, lineHeight: 1.4 },
  vacio: { fontSize: TYPE.small, color: MONO.faint },
  avance: { flexDirection: "row", marginBottom: 4 },
  avanceFecha: { width: 52, fontFamily: "Helvetica-Bold", fontSize: TYPE.small, color: MONO.label },
  avanceTexto: { flex: 1, fontSize: TYPE.body, lineHeight: 1.35 },
  nota: { fontSize: TYPE.small, color: MONO.label, marginTop: 4 },
  filaFotos: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  foto: { width: "48.5%" },
  fotoImg: { width: "100%", height: 190, objectFit: "contain", backgroundColor: "#f4f4f4" },
  fotoPie: { fontSize: TYPE.small, color: MONO.label, marginTop: 3 },
})

const COLUMNAS_TRABAJO: ColumnaTabla[] = [
  { key: "nombre", titulo: "DETALLE", flex: true, sangriaDerecha: 4 },
  { key: "cantidad", titulo: "CANT.", ancho: 44, alinear: "right" },
  { key: "importe", titulo: "IMPORTE", ancho: 96, alinear: "right", bold: true },
]

function filasDeFotos<T>(fotos: T[]): T[][] {
  const filas: T[][] = []
  for (let i = 0; i < fotos.length; i += 2) filas.push(fotos.slice(i, i + 2))
  return filas
}

export function InformeTecnicoDocument({
  data,
  logo = null,
  metrics,
}: {
  data: InformeTecnicoPDFData
  logo?: PdfLogo | null
  metrics: HelveticaMetrics
}) {
  const currency = (data.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE
  const fmt = (n: number) => formatCurrencyValue(n, currency)
  const fecha = (d: Date | string) => formatDateValue(d, tz)

  const e = data.equipo
  const equipoTitulo = [safe(e.tipo), safe(e.marca), safe(e.modelo)].filter(Boolean).join(" · ")
  const diagnostico = safe(data.diagnostico)
  const trabajos = data.trabajos.filter((t) => (Number(t.importe) || 0) !== 0)
  const subtotal = trabajos.reduce((s, t) => s + (Number(t.importe) || 0), 0)
  const total = data.costoFinal != null && data.costoFinal > 0 ? data.costoFinal : subtotal
  const otros = total - subtotal

  return (
    <Document title={`Informe técnico ${safe(data.codigoOrden)}`}>
      <Page size="A4" style={styles.page}>
        <Cabecera
          emisor={data}
          logo={logo}
          metrics={metrics}
          zonaDerecha="fija"
          titulo="INFORME TÉCNICO"
          numero={safe(data.codigoOrden)}
          lineasDerecha={[
            `Ingreso: ${fecha(data.fechaIngreso)}`,
            data.fechaEntrega ? `Entrega: ${fecha(data.fechaEntrega)}` : `Estado: ${safe(data.estado)}`,
          ]}
        >
          <BandaCliente
            label="Cliente"
            cliente={data.cliente}
            pais={data.pais}
            campos={["telefono", "email"]}
            espacioInferior={0}
            espacioDerecha={8}
          />
        </Cabecera>

        <Seccion titulo="Equipo">
          {equipoTitulo ? <FilaDetalle label="Equipo" valor={equipoTitulo} /> : null}
          {safe(e.color) ? <FilaDetalle label="Color" valor={safe(e.color)} /> : null}
          {safe(e.identificador) ? (
            <FilaDetalle label={safe(e.identificadorLabel) || "N° de serie"} valor={safe(e.identificador)} />
          ) : null}
          {safe(data.tecnicoNombre) ? <FilaDetalle label="Técnico" valor={safe(data.tecnicoNombre)} /> : null}
        </Seccion>

        <Seccion titulo="Falla informada">
          <Text style={styles.parrafo}>{safe(data.falla) || "Sin descripción"}</Text>
        </Seccion>

        <Seccion titulo="Diagnóstico">
          {diagnostico ? <Text style={styles.parrafo}>{diagnostico}</Text> : <Text style={styles.vacio}>Sin diagnóstico cargado.</Text>}
        </Seccion>

        {data.avances.length > 0 ? (
          <Seccion titulo="Avances de la reparación">
            {data.avances.map((a, i) => (
              <View key={i} style={styles.avance} wrap={false}>
                <Text style={styles.avanceFecha}>{fecha(a.fecha)}</Text>
                <Text style={styles.avanceTexto}>{safe(a.texto)}</Text>
              </View>
            ))}
          </Seccion>
        ) : null}

        <Seccion titulo="Trabajo realizado">
          {trabajos.length > 0 ? (
            <Tabla
              columnas={COLUMNAS_TRABAJO}
              headerFijo
              filas={trabajos.map((t) => ({
                nombre: safe(t.nombre) || "—",
                cantidad: t.cantidad ? String(t.cantidad) : "—",
                importe: fmt(t.importe),
              }))}
            />
          ) : (
            <Text style={styles.vacio}>Sin repuestos ni servicios con precio cargados.</Text>
          )}
          {trabajos.length > 0 && otros > 0 ? <FilaDetalle label="Mano de obra y otros" valor={fmt(otros)} /> : null}
          {total > 0 ? <BarraTotal label="TOTAL" valor={fmt(total)} /> : null}
          {data.garantia ? (
            <Text style={styles.nota}>
              Garantía de {data.garantia.dias} días, vigente hasta el {fecha(data.garantia.fechaVencimiento)}. Presentá este
              informe o el código {safe(data.codigoOrden)} para cualquier reclamo.
            </Text>
          ) : null}
        </Seccion>

        {data.fotos.length > 0 ? (
          <View style={estilosShell.seccion}>
            {filasDeFotos(data.fotos).map((fila, i) => (
              // Cada fila de dos fotos va entera a una página (react-pdf no parte
              // bien un contenedor con flexWrap y dibujaba sobre el pie), y el
              // título viaja con la primera fila para no quedar solo al pie.
              <View key={i} wrap={false}>
                {i === 0 ? <Text style={estilosShell.sectionLabel}>Fotos</Text> : null}
                <View style={[styles.filaFotos, i === 0 ? { marginTop: 8 } : {}]}>
                  {fila.map((f, j) => (
                    <View key={j} style={styles.foto}>
                      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image no tiene alt: el pie de foto la describe */}
                      <Image style={styles.fotoImg} src={{ data: f.jpeg, format: "jpg" }} />
                      <Text style={styles.fotoPie}>
                        {[safe(f.etiqueta), fecha(f.fecha), safe(f.descripcion)].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <Pie leyenda={leyendaPie("Informe técnico")} fechaImpresion={formatDateTimeValue(new Date(), tz)} />
      </Page>
    </Document>
  )
}

export async function generateInformeTecnicoPDF(data: InformeTecnicoPDFData): Promise<Buffer> {
  const [metrics, logo] = await Promise.all([helveticaMetrics(), fetchLogo(data.logoUrl)])
  return renderToBuffer(<InformeTecnicoDocument data={data} logo={logo} metrics={metrics} />)
}
