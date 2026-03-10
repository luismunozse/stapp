import React from "react"
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer"
import { PDFDocument as PDFLib, rgb, StandardFonts } from "pdf-lib"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "@/lib/timezone"

// ========================================
// ESTILOS MODERNOS PARA COTIZACION
// ========================================
const styles = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: 10,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  // Barra de acento superior
  accentBar: {
    height: 8,
    backgroundColor: "#6366f1",
  },
  // Container principal con padding
  container: {
    padding: 40,
    paddingTop: 30,
  },
  // Header moderno
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 25,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  logo: {
    width: 60,
    height: 60,
    marginRight: 15,
  },
  companyDetails: {
    flex: 1,
  },
  companyName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1e1b4b",
    marginBottom: 3,
  },
  companyInfo: {
    fontSize: 9,
    color: "#64748b",
    marginBottom: 1,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  docBadge: {
    backgroundColor: "#6366f1",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginBottom: 8,
  },
  docBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "bold",
  },
  docNumber: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1e1b4b",
  },
  docDate: {
    fontSize: 9,
    color: "#64748b",
    marginTop: 4,
  },
  // Cards/Secciones
  card: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#6366f1",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  cardLabel: {
    width: 80,
    fontSize: 9,
    color: "#64748b",
  },
  cardValue: {
    flex: 1,
    fontSize: 10,
    color: "#1e293b",
  },
  // Grid de 2 columnas
  twoColGrid: {
    flexDirection: "row",
    gap: 15,
    marginBottom: 15,
  },
  gridCol: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 15,
  },
  // Tabla moderna
  tableSection: {
    marginBottom: 20,
  },
  tableSectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#1e1b4b",
    marginBottom: 12,
  },
  table: {
    borderRadius: 8,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#6366f1",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tableHeaderText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  tableRowAlt: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  colDescription: {
    flex: 3,
    fontSize: 9,
  },
  colQuantity: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
  },
  colPrice: {
    flex: 1.2,
    textAlign: "right",
    fontSize: 9,
  },
  colSubtotal: {
    flex: 1.2,
    textAlign: "right",
    fontSize: 9,
    fontWeight: "bold",
  },
  // Totales
  totalsContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 15,
  },
  totalsBox: {
    width: 220,
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 15,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  totalLabel: {
    fontSize: 9,
    color: "#64748b",
  },
  totalValue: {
    fontSize: 10,
    color: "#1e293b",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopColor: "#6366f1",
  },
  grandTotalLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#1e1b4b",
  },
  grandTotalValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#6366f1",
  },
  // Validez
  validityBanner: {
    backgroundColor: "#fef3c7",
    borderRadius: 6,
    padding: 12,
    marginTop: 15,
    borderLeftWidth: 4,
    borderLeftColor: "#f59e0b",
  },
  validityText: {
    fontSize: 9,
    color: "#92400e",
    textAlign: "center",
  },
  // Notas
  notesCard: {
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    padding: 15,
    marginTop: 15,
  },
  notesTitle: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#475569",
    marginBottom: 6,
  },
  notesText: {
    fontSize: 9,
    color: "#64748b",
    lineHeight: 1.4,
  },
  // Firma
  signatureSection: {
    marginTop: 25,
    paddingTop: 20,
  },
  signatureContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  signatureBox: {
    width: 180,
    alignItems: "center",
  },
  signatureImage: {
    maxWidth: 120,
    maxHeight: 50,
    marginBottom: 5,
  },
  signatureLine: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "#94a3b8",
    marginTop: 5,
  },
  signatureLabel: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 5,
  },
  signatureDate: {
    fontSize: 7,
    color: "#94a3b8",
    marginTop: 2,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  footerText: {
    fontSize: 8,
    color: "#94a3b8",
  },
  footerBrand: {
    fontSize: 8,
    color: "#6366f1",
    fontWeight: "bold",
  },
})

interface CotizacionItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  precio_unitario?: number
  subtotal: number
  unidad?: string
  descuento_tipo?: string
  descuento_valor?: number
  descuentoTipo?: string
  descuentoValor?: number
}

interface CotizacionPDFData {
  numeroCotizacion: string
  fecha: Date
  fechaVencimiento?: Date | null
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
    direccion?: string | null
  }
  orden?: {
    numeroOrden: number
    dispositivo: string
    problemaReportado: string
  }
  items: CotizacionItem[]
  subtotal: number
  iva: number
  total: number
  notas?: string | null
  terminos?: string | null
  descuentoGlobalTipo?: string | null
  descuentoGlobalValor?: number | null
  ivaPorcentaje?: number | null
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  // Firma de aprobacion
  firmaAprobacion?: string | null
  firmaMime?: string | null
  fechaAprobacion?: Date | null
}

const formatCurrency = (amount: number | string | null | undefined, currency?: string) => {
  return formatCurrencyValue(amount, (currency as CurrencyCode) || DEFAULT_CURRENCY)
}

const formatDate = (date: Date | string | number | null | undefined, timezone?: string) => {
  if (!date) return ""
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ""

  return formatDateValue(parsed, timezone || DEFAULT_TIMEZONE)
}

// Ensure we never pass objects/React nodes into <Text>, which triggers React error #31
const toText = (val: unknown): string => {
  if (val === null || val === undefined || val === false) return ""
  if (React.isValidElement(val)) return ""
  if (Array.isArray(val)) {
    return val.map(v => toText(v)).join(", ")
  }
  if (typeof val === "object") {
    if (val instanceof Date) return formatDate(val)
    if ("$$typeof" in val) return ""
    try { return JSON.stringify(val) } catch { return String(val) }
  }
  if (typeof val === "symbol") return val.toString()
  return String(val)
}

// Safe createElement that filters out null/undefined/false children
// @react-pdf/renderer v4's yoga reconciler can choke on null children
const el = (
  type: any,
  props: any,
  ...children: any[]
): React.ReactElement => {
  const filtered = children.flat(Infinity).filter(
    (c): c is React.ReactNode => c !== null && c !== undefined && c !== false
  )
  return React.createElement(type, props, ...filtered)
}

const CotizacionDocument = ({ data }: { data: CotizacionPDFData }) => {
  const companyName = toText(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = toText(data.telefonoEmpresa)
  const direccionEmpresa = toText(data.direccionEmpresa)
  const logoUrl = toText(data.logoUrl)
  const cotizacionNumber = toText(data.numeroCotizacion)
  const cotizacionDate = formatDate(data.fecha, data.zonaHoraria)
  const clienteNombre = toText(data.cliente.nombre)
  const clienteTelefono = toText(data.cliente.telefono)
  const clienteEmail = toText(data.cliente.email)
  const clienteDireccion = toText(data.cliente.direccion)
  const ordenNumero = data.orden ? toText(data.orden.numeroOrden) : ""
  const dispositivo = data.orden ? toText(data.orden.dispositivo) : ""
  const problemaReportado = data.orden ? toText(data.orden.problemaReportado) : ""
  const notas = toText(data.notas)
  const terminos = toText(data.terminos)
  const fechaVencimiento = formatDate(data.fechaVencimiento, data.zonaHoraria)
  // Discount calculations for display - ensure numeric types (Supabase returns DECIMAL as string)
  const descGlobalTipo = String(data.descuentoGlobalTipo || "porcentaje")
  const descGlobalValor = Number(data.descuentoGlobalValor) || 0
  const subtotalNum = Number(data.subtotal) || 0
  const ivaNum = Number(data.iva) || 0
  const totalNum = Number(data.total) || 0
  let descGlobalAmount = 0
  if (descGlobalValor > 0) {
    descGlobalAmount = descGlobalTipo === "fijo"
      ? Math.min(descGlobalValor, subtotalNum)
      : subtotalNum * (descGlobalValor / 100)
  }
  const ivaPct = Number(data.ivaPorcentaje) || 0
  const firmaAprobacion = toText(data.firmaAprobacion)
  const firmaMime = toText(data.firmaMime)
  const fechaAprobacion = formatDate(data.fechaAprobacion, data.zonaHoraria)

  // Build items rows
  const itemRows = (Array.isArray(data.items) ? data.items : []).map((item, index) => {
    const unitPrice = Number(item.precioUnitario || item.precio_unitario) || 0
    const unidad = String(item.unidad || "Unidad")
    const cantLabel = `${String(item.cantidad || 0)} ${unidad !== "Unidad" ? unidad : ""}`.trim()
    const itemSubtotal = Number(item.subtotal) || 0
    return el(View, { key: String(index), style: index % 2 === 0 ? styles.tableRow : styles.tableRowAlt },
      el(Text, { style: styles.colDescription }, toText(item.descripcion)),
      el(Text, { style: styles.colQuantity }, cantLabel),
      el(Text, { style: styles.colPrice }, formatCurrency(unitPrice, data.moneda)),
      el(Text, { style: styles.colSubtotal }, formatCurrency(itemSubtotal, data.moneda))
    )
  })

  // Build totals rows array (no nulls)
  const totalsRows: React.ReactElement[] = [
    el(View, { key: "sub", style: styles.totalRow },
      el(Text, { style: styles.totalLabel }, "Subtotal"),
      el(Text, { style: styles.totalValue }, formatCurrency(subtotalNum, data.moneda))
    ),
  ]
  if (descGlobalAmount > 0) {
    totalsRows.push(
      el(View, { key: "desc", style: styles.totalRow },
        el(Text, { style: styles.totalLabel }, descGlobalTipo === "porcentaje" ? `Descuento (${String(descGlobalValor)}%)` : "Descuento"),
        el(Text, { style: [styles.totalValue, { color: "#16a34a" }] }, `-${formatCurrency(descGlobalAmount, data.moneda)}`)
      )
    )
  }
  if (ivaPct > 0) {
    totalsRows.push(
      el(View, { key: "iva", style: styles.totalRow },
        el(Text, { style: styles.totalLabel }, `IVA (${String(ivaPct)}%)`),
        el(Text, { style: styles.totalValue }, formatCurrency(ivaNum, data.moneda))
      )
    )
  }
  totalsRows.push(
    el(View, { key: "total", style: styles.grandTotalRow },
      el(Text, { style: styles.grandTotalLabel }, "TOTAL"),
      el(Text, { style: styles.grandTotalValue }, formatCurrency(totalNum, data.moneda))
    )
  )

  // Build optional sections array
  const optionalSections: React.ReactElement[] = []

  if (fechaVencimiento) {
    optionalSections.push(
      el(View, { key: "validez", style: styles.validityBanner },
        el(Text, { style: styles.validityText }, `Cotizacion valida hasta el ${fechaVencimiento}`)
      )
    )
  }
  if (notas) {
    optionalSections.push(
      el(View, { key: "notas", style: styles.notesCard },
        el(Text, { style: styles.notesTitle }, "Observaciones"),
        el(Text, { style: styles.notesText }, notas)
      )
    )
  }
  if (terminos) {
    optionalSections.push(
      el(View, { key: "terminos", style: styles.notesCard },
        el(Text, { style: styles.notesTitle }, "Terminos y Condiciones"),
        el(Text, { style: styles.notesText }, terminos)
      )
    )
  }
  if (firmaAprobacion && firmaMime) {
    optionalSections.push(
      el(View, { key: "firma", style: styles.signatureSection },
        el(View, { style: styles.signatureContainer },
          el(View, { style: styles.signatureBox },
            el(Image, { style: styles.signatureImage, src: `data:${firmaMime};base64,${firmaAprobacion}` }),
            el(View, { style: styles.signatureLine }),
            el(Text, { style: styles.signatureLabel }, "Firma del Cliente"),
            fechaAprobacion ? el(Text, { style: styles.signatureDate }, `Aprobado: ${fechaAprobacion}`) : null
          )
        )
      )
    )
  }

  // Build cliente card rows
  const clienteRows: React.ReactElement[] = [
    el(View, { key: "cn", style: styles.cardRow },
      el(Text, { style: styles.cardLabel }, "Nombre"),
      el(Text, { style: styles.cardValue }, clienteNombre)
    ),
    el(View, { key: "ct", style: styles.cardRow },
      el(Text, { style: styles.cardLabel }, "Telefono"),
      el(Text, { style: styles.cardValue }, clienteTelefono)
    ),
  ]
  if (clienteEmail) {
    clienteRows.push(
      el(View, { key: "ce", style: styles.cardRow },
        el(Text, { style: styles.cardLabel }, "Email"),
        el(Text, { style: styles.cardValue }, clienteEmail)
      )
    )
  }
  if (clienteDireccion) {
    clienteRows.push(
      el(View, { key: "cd", style: styles.cardRow },
        el(Text, { style: styles.cardLabel }, "Direccion"),
        el(Text, { style: styles.cardValue }, clienteDireccion)
      )
    )
  }

  // Build grid columns
  const gridCols: React.ReactElement[] = [
    el(View, { key: "cliente", style: styles.gridCol },
      el(Text, { style: styles.cardTitle }, "Cliente"),
      ...clienteRows
    ),
  ]
  if (data.orden) {
    gridCols.push(
      el(View, { key: "orden", style: styles.gridCol },
        el(Text, { style: styles.cardTitle }, `Orden #${ordenNumero}`),
        el(View, { style: styles.cardRow },
          el(Text, { style: styles.cardLabel }, "Equipo"),
          el(Text, { style: styles.cardValue }, dispositivo)
        ),
        el(View, { style: styles.cardRow },
          el(Text, { style: styles.cardLabel }, "Problema"),
          el(Text, { style: styles.cardValue }, problemaReportado)
        )
      )
    )
  }

  // Build header left children
  const headerLeftChildren: React.ReactElement[] = []
  if (logoUrl) {
    headerLeftChildren.push(el(Image, { key: "logo", style: styles.logo, src: logoUrl }))
  }
  const companyInfoChildren: React.ReactElement[] = [
    el(Text, { key: "name", style: styles.companyName }, companyName),
  ]
  if (telefonoEmpresa) {
    companyInfoChildren.push(el(Text, { key: "tel", style: styles.companyInfo }, `Tel: ${telefonoEmpresa}`))
  }
  if (direccionEmpresa) {
    companyInfoChildren.push(el(Text, { key: "dir", style: styles.companyInfo }, direccionEmpresa))
  }
  headerLeftChildren.push(el(View, { key: "details", style: styles.companyDetails }, ...companyInfoChildren))

  return el(Document, null,
    el(Page, { size: "A4", style: styles.page },
      // Barra de acento
      el(View, { style: styles.accentBar }),
      // Container principal
      el(View, { style: styles.container },
        // Header
        el(View, { style: styles.header },
          el(View, { style: styles.headerLeft }, ...headerLeftChildren),
          el(View, { style: styles.headerRight },
            el(View, { style: styles.docBadge },
              el(Text, { style: styles.docBadgeText }, "COTIZACION")
            ),
            el(Text, { style: styles.docNumber }, cotizacionNumber),
            el(Text, { style: styles.docDate }, cotizacionDate)
          )
        ),
        // Grid cliente/orden
        el(View, { style: styles.twoColGrid }, ...gridCols),
        // Tabla items
        el(View, { style: styles.tableSection },
          el(Text, { style: styles.tableSectionTitle }, "Detalle de Servicios"),
          el(View, { style: styles.table },
            el(View, { style: styles.tableHeader },
              el(Text, { style: [styles.colDescription, styles.tableHeaderText] }, "Descripcion"),
              el(Text, { style: [styles.colQuantity, styles.tableHeaderText] }, "Cant."),
              el(Text, { style: [styles.colPrice, styles.tableHeaderText] }, "P. Unit."),
              el(Text, { style: [styles.colSubtotal, styles.tableHeaderText] }, "Subtotal")
            ),
            ...itemRows
          )
        ),
        // Totales
        el(View, { style: styles.totalsContainer },
          el(View, { style: styles.totalsBox }, ...totalsRows)
        ),
        // Secciones opcionales
        ...optionalSections
      ),
      // Footer
      el(View, { style: styles.footer },
        el(Text, { style: styles.footerText },
          firmaAprobacion ? "Documento aprobado por el cliente" : "Gracias por su confianza"
        ),
        el(Text, { style: styles.footerBrand }, companyName)
      )
    )
  )
}

export async function generateCotizacionPDF(data: CotizacionPDFData): Promise<Buffer> {
  const buffer = await renderToBuffer(
    React.createElement(CotizacionDocument, { data }) as React.ReactElement
  )
  return Buffer.from(buffer)
}

// ========================================
// COMPROBANTE DE ORDEN DE SERVICIO
// ========================================

const ordenStyles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: "#3b82f6",
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1f2937",
  },
  subtitle: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 2,
  },
  ordenNumber: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#3b82f6",
  },
  ordenDate: {
    fontSize: 9,
    color: "#6b7280",
    marginTop: 4,
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#374151",
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  row: {
    flexDirection: "row",
    marginBottom: 3,
  },
  label: {
    width: 110,
    color: "#6b7280",
    fontSize: 9,
  },
  value: {
    flex: 1,
    color: "#1f2937",
    fontSize: 9,
  },
  highlight: {
    backgroundColor: "#f3f4f6",
    padding: 10,
    borderRadius: 4,
    marginTop: 5,
  },
  highlightText: {
    fontSize: 9,
    color: "#374151",
  },
  accesoriosBox: {
    backgroundColor: "#fef3c7",
    padding: 10,
    borderRadius: 4,
    marginTop: 10,
  },
  accesoriosTitle: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#92400e",
    marginBottom: 4,
  },
  accesoriosText: {
    fontSize: 9,
    color: "#78350f",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 30,
    right: 30,
  },
  footerTop: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
    marginBottom: 10,
  },
  footerText: {
    fontSize: 8,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 3,
  },
  footerTextBold: {
    fontSize: 8,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 3,
    fontWeight: "bold",
  },
  signatureLine: {
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureBox: {
    width: "45%",
    alignItems: "center",
  },
  signatureDash: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "#374151",
    marginBottom: 4,
  },
  signatureLabel: {
    fontSize: 8,
    color: "#6b7280",
  },
  qrSection: {
    marginTop: 15,
    padding: 10,
    backgroundColor: "#f0f9ff",
    borderRadius: 4,
    alignItems: "center",
  },
  qrText: {
    fontSize: 8,
    color: "#0369a1",
    textAlign: "center",
  },
  logo: {
    width: 60,
    height: 60,
    marginRight: 10,
    objectFit: "contain",
  },
  headerWithLogo: {
    flexDirection: "row",
    alignItems: "center",
  },
})

interface OrdenPDFData {
  numeroOrden: number
  fechaIngreso: Date
  fechaPrometida?: Date | null
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
    direccion?: string | null
  }
  dispositivo: string
  tipoDispositivo: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  problemaReportado: string
  accesorios?: string | null
  codigoAccesoDispositivo?: string | null
  presupuesto?: number | null
  observaciones?: string | null
  nombreEmpresa?: string
  telefonoEmpresa?: string
  direccionEmpresa?: string
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  // Datos de entrega (si la orden fue entregada)
  estado?: string
  fechaEntrega?: Date | null
  firmaClienteEntrega?: string | null
  firmaClienteEntregaMime?: string | null
  firmaEncargadoEntrega?: string | null
  firmaEncargadoEntregaMime?: string | null
  entregadoPor?: string | null
  notasEntrega?: string | null
}

const tipoDispositivoLabels: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  SMARTWATCH: "Smartwatch",
}

const OrdenDocument = ({ data }: { data: OrdenPDFData }) => {
  // Ensure all values are primitives, never objects
  const empresaNombre = toText(data.nombreEmpresa) || "Servicio Tecnico"
  const numeroOrden = toText(data.numeroOrden)
  const fechaIngreso = formatDate(data.fechaIngreso, data.zonaHoraria)
  const fechaPrometida = formatDate(data.fechaPrometida, data.zonaHoraria)

  // Safely extract cliente data with fallbacks
  const cliente = data.cliente || { nombre: "", telefono: "", email: null, direccion: null }
  const clienteNombre = toText(cliente.nombre) || "Sin nombre"
  const clienteTelefono = toText(cliente.telefono) || "Sin teléfono"
  const clienteEmail = toText(cliente.email)
  const clienteDireccion = toText(cliente.direccion)
  const tipoDispositivo = toText(tipoDispositivoLabels[data.tipoDispositivo] || data.tipoDispositivo)
  const dispositivo = toText(data.dispositivo)
  const marca = toText(data.marca)
  const color = toText(data.color)
  const imei = toText(data.imei)
  const problemaReportado = toText(data.problemaReportado)
  const accesorios = toText(data.accesorios)
  const codigoAccesoDispositivo = toText(data.codigoAccesoDispositivo)
  const presupuesto =
    data.presupuesto !== null && data.presupuesto !== undefined
      ? formatCurrency(data.presupuesto, data.moneda)
      : ""
  const observaciones = toText(data.observaciones)
  const telefonoEmpresa = toText(data.telefonoEmpresa)
  const direccionEmpresa = toText(data.direccionEmpresa)

  // Construir documento de forma mas simple sin spread operators
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: ordenStyles.page },
      // Header
      React.createElement(
        View,
        { style: ordenStyles.header },
        React.createElement(
          View,
          { style: ordenStyles.headerLeft },
          React.createElement(Text, { style: ordenStyles.title }, empresaNombre),
          telefonoEmpresa ? React.createElement(Text, { style: ordenStyles.subtitle }, "Tel: " + telefonoEmpresa) : null,
          direccionEmpresa ? React.createElement(Text, { style: ordenStyles.subtitle }, direccionEmpresa) : null
        ),
        React.createElement(
          View,
          { style: ordenStyles.headerRight },
          React.createElement(Text, { style: ordenStyles.ordenNumber }, "#" + numeroOrden),
          React.createElement(Text, { style: ordenStyles.ordenDate }, "Fecha: " + fechaIngreso),
          fechaPrometida ? React.createElement(Text, { style: ordenStyles.ordenDate }, "Entrega est.: " + fechaPrometida) : null
        )
      ),
      // Titulo
      React.createElement(
        View,
        { style: { marginBottom: 15, alignItems: "center" } },
        React.createElement(Text, { style: { fontSize: 14, fontWeight: "bold", color: "#1f2937" } }, "COMPROBANTE DE RECEPCION")
      ),
      // Datos del Cliente
      React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "DATOS DEL CLIENTE"),
        React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Nombre:"),
          React.createElement(Text, { style: ordenStyles.value }, clienteNombre)
        ),
        React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Telefono:"),
          React.createElement(Text, { style: ordenStyles.value }, clienteTelefono)
        ),
        clienteEmail ? React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Email:"),
          React.createElement(Text, { style: ordenStyles.value }, clienteEmail)
        ) : null,
        clienteDireccion ? React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Direccion:"),
          React.createElement(Text, { style: ordenStyles.value }, clienteDireccion)
        ) : null
      ),
      // Datos del Dispositivo
      React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "DATOS DEL DISPOSITIVO"),
        React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Tipo:"),
          React.createElement(Text, { style: ordenStyles.value }, tipoDispositivo)
        ),
        React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Dispositivo:"),
          React.createElement(Text, { style: ordenStyles.value }, dispositivo)
        ),
        marca ? React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Marca:"),
          React.createElement(Text, { style: ordenStyles.value }, marca)
        ) : null,
        color ? React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "Color:"),
          React.createElement(Text, { style: ordenStyles.value }, color)
        ) : null,
        imei ? React.createElement(
          View,
          { style: ordenStyles.row },
          React.createElement(Text, { style: ordenStyles.label }, "IMEI/Serie:"),
          React.createElement(Text, { style: ordenStyles.value }, imei)
        ) : null
      ),
      // Problema Reportado
      React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "PROBLEMA REPORTADO"),
        React.createElement(
          View,
          { style: ordenStyles.highlight },
          React.createElement(Text, { style: ordenStyles.highlightText }, problemaReportado)
        )
      ),
      // Accesorios (si hay)
      accesorios ? React.createElement(
        View,
        { style: ordenStyles.accesoriosBox },
        React.createElement(Text, { style: ordenStyles.accesoriosTitle }, "ACCESORIOS ENTREGADOS:"),
        React.createElement(Text, { style: ordenStyles.accesoriosText }, accesorios)
      ) : null,
      // Contrasena/PIN (si hay, sin SVG por ahora para simplificar)
      codigoAccesoDispositivo ? React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "CONTRASENA/PIN"),
        React.createElement(
          View,
          { style: { backgroundColor: "#f3f4f6", padding: 8, borderRadius: 4 } },
          React.createElement(Text, { style: { fontSize: 12, fontFamily: "Courier" } }, codigoAccesoDispositivo)
        )
      ) : null,
      // Presupuesto (si hay)
      presupuesto ? React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "PRESUPUESTO ESTIMADO"),
        React.createElement(Text, { style: { fontSize: 14, fontWeight: "bold", color: "#3b82f6" } }, presupuesto),
        React.createElement(Text, { style: { fontSize: 8, color: "#6b7280", marginTop: 2 } }, "* El presupuesto final puede variar segun el diagnostico")
      ) : null,
      // Observaciones (si hay)
      observaciones ? React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "OBSERVACIONES"),
        React.createElement(Text, { style: ordenStyles.highlightText }, observaciones)
      ) : null,
      // Lineas de firma
      React.createElement(
        View,
        { style: ordenStyles.signatureLine },
        React.createElement(
          View,
          { style: ordenStyles.signatureBox },
          React.createElement(View, { style: ordenStyles.signatureDash }),
          React.createElement(Text, { style: ordenStyles.signatureLabel }, "Firma del Cliente")
        ),
        React.createElement(
          View,
          { style: ordenStyles.signatureBox },
          React.createElement(View, { style: ordenStyles.signatureDash }),
          React.createElement(Text, { style: ordenStyles.signatureLabel }, "Firma del Tecnico")
        )
      ),
      // Footer
      React.createElement(
        View,
        { style: ordenStyles.footer },
        React.createElement(
          View,
          { style: ordenStyles.footerTop },
          React.createElement(Text, { style: ordenStyles.footerText }, "Conserve este comprobante para retirar su equipo."),
          React.createElement(Text, { style: ordenStyles.footerText }, "Al firmar, el cliente acepta los terminos y condiciones del servicio."),
          React.createElement(Text, { style: ordenStyles.footerTextBold }, "Orden #" + numeroOrden + " - " + empresaNombre)
        )
      )
    )
  )
}

export async function generateOrdenPDF(data: OrdenPDFData): Promise<Buffer> {
  // Helper para texto seguro
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  // Extraer datos de forma segura
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroOrden = safe(data.numeroOrden)
  const fechaIngreso = formatDatePDF(data.fechaIngreso)
  const fechaPrometida = formatDatePDF(data.fechaPrometida)

  const cliente = data.cliente || { nombre: "", telefono: "", email: null, direccion: null }
  const clienteNombre = safe(cliente.nombre) || "Sin nombre"
  const clienteTelefono = safe(cliente.telefono) || "Sin telefono"
  const clienteEmail = safe(cliente.email)
  const clienteDireccion = safe(cliente.direccion)

  const tipoLabels: Record<string, string> = {
    CELULAR: "Celular", COMPUTADORA: "Computadora", TABLET: "Tablet",
    CONSOLA: "Consola", SMARTWATCH: "Smartwatch", OTRO: "Otro"
  }
  const tipoDispositivo = tipoLabels[data.tipoDispositivo] || safe(data.tipoDispositivo) || "Otro"
  const dispositivo = safe(data.dispositivo) || "Sin especificar"
  const marca = safe(data.marca)
  const colorDisp = safe(data.color)
  const imei = safe(data.imei)
  const problemaReportado = safe(data.problemaReportado) || "Sin descripcion"
  const accesorios = safe(data.accesorios)
  const codigoAccesoDispositivo = safe(data.codigoAccesoDispositivo)
  const presupuesto = data.presupuesto ? formatCurrencyPDF(data.presupuesto) : ""
  const observaciones = safe(data.observaciones)

  // Fecha y hora de impresion
  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const courier = await pdfDoc.embedFont(StandardFonts.Courier)

  // Colores modernos (Indigo theme)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const slateLight = rgb(0.945, 0.953, 0.965) // #f1f5f9
  const yellowBg = rgb(0.996, 0.953, 0.780) // #fef3c7
  const yellowBorder = rgb(0.961, 0.620, 0.043) // #f59e0b
  const brownColor = rgb(0.573, 0.251, 0.055) // #92400e
  const greenColor = rgb(0.134, 0.545, 0.373) // #22c55e
  const greenBg = rgb(0.863, 0.949, 0.898) // #dcfce7
  const white = rgb(1, 1, 1)

  // Margenes
  const margin = 40
  const contentWidth = width - (margin * 2)
  const cardGap = 10
  const halfWidth = (contentWidth - cardGap) / 2

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: primaryColor })

  let y = height - margin - 15

  // === LOGO (si existe) ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)
        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""
        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }
        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 45
          const maxLogoWidth = 60
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale
          page.drawImage(logoImage, { x: margin, y: y - scaledHeight + 5, width: scaledWidth, height: scaledHeight })
          logoWidth = scaledWidth + 12
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER - Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 18, font: helveticaBold, color: textColor })
  y -= 14
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 11
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
  }

  // === BADGE ORDEN (lado derecho) ===
  const badgeText = "RECEPCION"
  const badgeWidth = helveticaBold.widthOfTextAtSize(badgeText, 10) + 20
  page.drawRectangle({ x: width - margin - badgeWidth, y: height - margin - 25, width: badgeWidth, height: 22, color: primaryColor })
  page.drawText(badgeText, { x: width - margin - badgeWidth + 10, y: height - margin - 19, size: 10, font: helveticaBold, color: white })

  // Numero de orden grande
  const ordenText = `#${String(numeroOrden).padStart(4, "0")}`
  const ordenTextWidth = helveticaBold.widthOfTextAtSize(ordenText, 22)
  page.drawText(ordenText, { x: width - margin - ordenTextWidth, y: height - margin - 50, size: 22, font: helveticaBold, color: textColor })

  // Fechas
  page.drawText(`Ingreso: ${fechaIngreso}`, { x: width - margin - 95, y: height - margin - 68, size: 8, font: helvetica, color: grayColor })
  if (fechaPrometida) {
    page.drawText(`Entrega: ${fechaPrometida}`, { x: width - margin - 95, y: height - margin - 80, size: 8, font: helvetica, color: grayColor })
  }

  y = height - margin - 95

  // === TITULO ===
  const titleText = "COMPROBANTE DE RECEPCION"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 13)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 13, font: helveticaBold, color: primaryColor })
  y -= 20

  // === GRID: CLIENTE | DISPOSITIVO ===
  const cardHeight = 85

  // Card Cliente - con borde y mejor diseño
  page.drawRectangle({ x: margin, y: y - cardHeight, width: halfWidth, height: cardHeight, color: white, borderColor: lightGray, borderWidth: 1 })
  // Barra de acento izquierda
  page.drawRectangle({ x: margin, y: y - cardHeight, width: 4, height: cardHeight, color: primaryColor })
  // Header del card
  page.drawRectangle({ x: margin + 4, y: y - 20, width: halfWidth - 4, height: 20, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 14, y: y - 14, size: 9, font: helveticaBold, color: primaryColor })
  // Contenido
  page.drawText("Nombre:", { x: margin + 14, y: y - 35, size: 8, font: helvetica, color: grayColor })
  page.drawText(clienteNombre.substring(0, 30), { x: margin + 60, y: y - 35, size: 9, font: helveticaBold, color: textColor })
  page.drawText("Telefono:", { x: margin + 14, y: y - 50, size: 8, font: helvetica, color: grayColor })
  page.drawText(clienteTelefono, { x: margin + 60, y: y - 50, size: 9, font: helvetica, color: textColor })
  if (clienteEmail) {
    page.drawText("Email:", { x: margin + 14, y: y - 65, size: 8, font: helvetica, color: grayColor })
    page.drawText(clienteEmail.substring(0, 25), { x: margin + 60, y: y - 65, size: 8, font: helvetica, color: textColor })
  }
  if (clienteDireccion) {
    page.drawText("Dir:", { x: margin + 14, y: y - 78, size: 8, font: helvetica, color: grayColor })
    page.drawText(clienteDireccion.substring(0, 28), { x: margin + 60, y: y - 78, size: 8, font: helvetica, color: textColor })
  }

  // Card Dispositivo - con borde y mejor diseño
  const cardX2 = margin + halfWidth + cardGap
  page.drawRectangle({ x: cardX2, y: y - cardHeight, width: halfWidth, height: cardHeight, color: white, borderColor: lightGray, borderWidth: 1 })
  // Barra de acento izquierda
  page.drawRectangle({ x: cardX2, y: y - cardHeight, width: 4, height: cardHeight, color: primaryColor })
  // Header del card
  page.drawRectangle({ x: cardX2 + 4, y: y - 20, width: halfWidth - 4, height: 20, color: bgGray })
  page.drawText("DISPOSITIVO", { x: cardX2 + 14, y: y - 14, size: 9, font: helveticaBold, color: primaryColor })
  // Contenido
  page.drawText("Tipo:", { x: cardX2 + 14, y: y - 35, size: 8, font: helvetica, color: grayColor })
  page.drawText(tipoDispositivo, { x: cardX2 + 50, y: y - 35, size: 9, font: helvetica, color: textColor })
  page.drawText("Modelo:", { x: cardX2 + 14, y: y - 50, size: 8, font: helvetica, color: grayColor })
  page.drawText(dispositivo.substring(0, 25), { x: cardX2 + 55, y: y - 50, size: 9, font: helveticaBold, color: textColor })

  let deviceInfoY = y - 65
  if (marca) {
    page.drawText("Marca:", { x: cardX2 + 14, y: deviceInfoY, size: 8, font: helvetica, color: grayColor })
    page.drawText(marca, { x: cardX2 + 50, y: deviceInfoY, size: 8, font: helvetica, color: textColor })
  }
  if (colorDisp) {
    page.drawText("Color:", { x: cardX2 + 130, y: deviceInfoY, size: 8, font: helvetica, color: grayColor })
    page.drawText(colorDisp, { x: cardX2 + 160, y: deviceInfoY, size: 8, font: helvetica, color: textColor })
  }
  if (imei) {
    page.drawText("IMEI:", { x: cardX2 + 14, y: deviceInfoY - 13, size: 8, font: helvetica, color: grayColor })
    page.drawText(imei, { x: cardX2 + 50, y: deviceInfoY - 13, size: 8, font: helvetica, color: textColor })
  }

  y -= cardHeight + 15

  // === PROBLEMA REPORTADO ===
  page.drawText("PROBLEMA REPORTADO", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
  y -= 12

  const problemaLines = []
  let tempLine = ""
  const words = problemaReportado.split(" ")
  for (const word of words) {
    if (helvetica.widthOfTextAtSize(tempLine + " " + word, 10) < contentWidth - 24) {
      tempLine += (tempLine ? " " : "") + word
    } else {
      problemaLines.push(tempLine)
      tempLine = word
    }
  }
  if (tempLine) problemaLines.push(tempLine)
  const problemaHeight = Math.max(35, problemaLines.length * 14 + 16)

  page.drawRectangle({ x: margin, y: y - problemaHeight, width: contentWidth, height: problemaHeight, color: slateLight, borderColor: lightGray, borderWidth: 1 })
  let problemaY = y - 14
  for (const line of problemaLines.slice(0, 4)) {
    page.drawText(line, { x: margin + 12, y: problemaY, size: 10, font: helvetica, color: textColor })
    problemaY -= 14
  }
  y -= problemaHeight + 12

  // === ACCESORIOS (si hay) ===
  if (accesorios) {
    page.drawRectangle({ x: margin, y: y - 32, width: contentWidth, height: 32, color: yellowBg, borderColor: yellowBorder, borderWidth: 1 })
    page.drawText("ACCESORIOS:", { x: margin + 12, y: y - 12, size: 9, font: helveticaBold, color: brownColor })
    page.drawText(accesorios.substring(0, 70), { x: margin + 90, y: y - 12, size: 9, font: helvetica, color: brownColor })
    y -= 44
  }

  // === CONTRASENA (si hay) ===
  if (codigoAccesoDispositivo) {
    page.drawText("CONTRASEÑA / PIN / PATRON", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
    y -= 12

    // Detectar si es un patrón
    const isPattern = codigoAccesoDispositivo.toLowerCase().startsWith("patrón:") ||
                      codigoAccesoDispositivo.toLowerCase().startsWith("patron:")

    if (isPattern) {
      // Extraer los números del patrón (ej: "Patrón: 7-8-9-6-3-2-1-4" -> [7,8,9,6,3,2,1,4])
      const patternMatch = codigoAccesoDispositivo.match(/[\d-]+$/)
      const patternNumbers = patternMatch
        ? patternMatch[0].split("-").map(n => parseInt(n.trim())).filter(n => n >= 1 && n <= 9)
        : []

      // Dibujar caja del patrón
      const patternBoxWidth = 180
      const patternBoxHeight = 90
      page.drawRectangle({ x: margin, y: y - patternBoxHeight, width: patternBoxWidth, height: patternBoxHeight, color: bgGray, borderColor: lightGray, borderWidth: 1 })

      // Posiciones de los 9 puntos en una grilla 3x3
      // La grilla de Android es: 1-2-3 / 4-5-6 / 7-8-9
      const gridStartX = margin + 30
      const gridStartY = y - 20
      const cellSize = 25
      const dotRadius = 4

      const getPointPosition = (num: number) => {
        const row = Math.floor((num - 1) / 3)  // 0, 1, 2
        const col = (num - 1) % 3              // 0, 1, 2
        return {
          x: gridStartX + col * cellSize + cellSize / 2,
          y: gridStartY - row * cellSize - cellSize / 2
        }
      }

      // Dibujar líneas conectando los puntos del patrón
      if (patternNumbers.length > 1) {
        for (let i = 0; i < patternNumbers.length - 1; i++) {
          const start = getPointPosition(patternNumbers[i])
          const end = getPointPosition(patternNumbers[i + 1])
          page.drawLine({
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            thickness: 2,
            color: primaryColor
          })
        }
      }

      // Dibujar los 9 puntos
      for (let num = 1; num <= 9; num++) {
        const pos = getPointPosition(num)
        const isInPattern = patternNumbers.includes(num)

        // Punto exterior (siempre visible)
        page.drawCircle({
          x: pos.x,
          y: pos.y,
          size: dotRadius,
          color: isInPattern ? primaryColor : grayColor,
          borderWidth: 0
        })

        // Punto interior más pequeño para los activos
        if (isInPattern) {
          page.drawCircle({
            x: pos.x,
            y: pos.y,
            size: dotRadius - 2,
            color: rgb(1, 1, 1),
            borderWidth: 0
          })
        }
      }

      // Mostrar secuencia al lado
      page.drawText("Secuencia:", { x: margin + 105, y: y - 30, size: 8, font: helveticaBold, color: grayColor })
      page.drawText(patternNumbers.join(" > "), { x: margin + 105, y: y - 45, size: 10, font: courier, color: textColor })

      y -= patternBoxHeight + 12
    } else {
      // PIN o Contraseña - mostrar como texto
      page.drawRectangle({ x: margin, y: y - 22, width: 180, height: 22, color: bgGray, borderColor: lightGray, borderWidth: 1 })
      page.drawText(codigoAccesoDispositivo, { x: margin + 10, y: y - 15, size: 12, font: courier, color: textColor })
      y -= 34
    }
  }

  // === PRESUPUESTO (si hay) ===
  if (presupuesto) {
    page.drawRectangle({ x: margin, y: y - 40, width: contentWidth, height: 40, color: greenBg, borderColor: greenColor, borderWidth: 1 })
    page.drawText("PRESUPUESTO ESTIMADO", { x: margin + 12, y: y - 12, size: 9, font: helveticaBold, color: greenColor })
    page.drawText(presupuesto, { x: margin + 12, y: y - 30, size: 16, font: helveticaBold, color: greenColor })
    page.drawText("* Puede variar segun diagnostico", { x: margin + 160, y: y - 32, size: 7, font: helvetica, color: grayColor })
    y -= 52
  }

  // === OBSERVACIONES (si hay) ===
  if (observaciones) {
    page.drawText("OBSERVACIONES", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
    y -= 12
    page.drawText(observaciones.substring(0, 90), { x: margin, y, size: 9, font: helvetica, color: textColor })
    y -= 18
  }

  // === SECCION TERMINOS Y CONDICIONES ===
  const terminosStartY = Math.max(y - 15, 230)

  // Caja de términos y condiciones
  const terminosBoxHeight = 70
  page.drawRectangle({
    x: margin,
    y: terminosStartY - terminosBoxHeight,
    width: contentWidth,
    height: terminosBoxHeight,
    color: rgb(0.98, 0.98, 0.98),
    borderColor: lightGray,
    borderWidth: 1
  })

  // Header de términos
  page.drawRectangle({
    x: margin,
    y: terminosStartY - 18,
    width: contentWidth,
    height: 18,
    color: rgb(0.95, 0.95, 0.95)
  })
  page.drawText("TERMINOS Y CONDICIONES", { x: margin + 12, y: terminosStartY - 13, size: 9, font: helveticaBold, color: grayColor })

  // Términos
  const terminos = [
    "1. Conserve este comprobante para retirar su equipo. El plazo de retiro es de 30 dias.",
    "2. No nos hacemos responsables por datos perdidos. Realice backup antes de entregar el equipo.",
    "3. Al firmar, el cliente declara haber revisado el estado del equipo al momento de la entrega.",
    "4. El presupuesto puede variar segun el diagnostico final del equipo."
  ]
  let termY = terminosStartY - 32
  terminos.forEach(t => {
    page.drawText(t, { x: margin + 12, y: termY, size: 8, font: helvetica, color: textColor })
    termY -= 12
  })

  // === FOOTER ===
  page.drawText(`Orden #${numeroOrden}`, { x: margin, y: 25, size: 8, font: helveticaBold, color: primaryColor })
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 100, y: 25, size: 7, font: helvetica, color: grayColor })

  // === BARRA INFERIOR ===
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: primaryColor })

  // === SECCION DE ENTREGA (segunda pagina, solo si fue entregado) ===
  if (data.estado === "ENTREGADO" && data.firmaClienteEntrega) {
    const page2 = pdfDoc.addPage([width, height])
    let ey = height - margin

    // Barra superior
    page2.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: primaryColor })
    ey -= 10

    // Titulo
    page2.drawText("COMPROBANTE DE ENTREGA", { x: margin, y: ey, size: 14, font: helveticaBold, color: primaryColor })
    page2.drawText(`Orden #${numeroOrden}`, { x: width - margin - 80, y: ey, size: 10, font: helveticaBold, color: grayColor })
    ey -= 25

    // Linea separadora
    page2.drawLine({ start: { x: margin, y: ey }, end: { x: width - margin, y: ey }, thickness: 1, color: primaryColor })
    ey -= 20

    // Info de entrega
    page2.drawText("Fecha de entrega:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
    page2.drawText(data.fechaEntrega ? formatDatePDF(data.fechaEntrega) : "-", { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
    ey -= 16

    page2.drawText("Dispositivo:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
    page2.drawText(safe(data.dispositivo), { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
    ey -= 16

    page2.drawText("Cliente:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
    page2.drawText(safe(data.cliente.nombre), { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
    ey -= 16

    if (data.entregadoPor) {
      page2.drawText("Entregado por:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
      page2.drawText(safe(data.entregadoPor), { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
      ey -= 16
    }

    if (data.notasEntrega) {
      ey -= 5
      page2.drawText("Notas de entrega:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
      ey -= 14
      page2.drawText(safe(data.notasEntrega).substring(0, 200), { x: margin, y: ey, size: 9, font: helvetica, color: textColor })
      ey -= 16
    }

    ey -= 15

    // Firmas de entrega
    const entregaHalfWidth = (width - 2 * margin - 20) / 2
    const entregaCardX2 = margin + entregaHalfWidth + 20

    // Firma Cliente Entrega
    page2.drawRectangle({ x: margin, y: ey - 85, width: entregaHalfWidth, height: 100, color: bgGray, borderColor: lightGray, borderWidth: 1 })
    page2.drawRectangle({ x: margin, y: ey + 5, width: entregaHalfWidth, height: 18, color: rgb(0.95, 0.95, 0.95) })
    page2.drawText("CLIENTE (quien recibe)", { x: margin + 12, y: ey + 10, size: 8, font: helveticaBold, color: grayColor })

    try {
      const firmaClienteEntregaBytes = Uint8Array.from(atob(data.firmaClienteEntrega), c => c.charCodeAt(0))
      const firmaClienteEntregaImg = await pdfDoc.embedPng(firmaClienteEntregaBytes)
      const ceDims = firmaClienteEntregaImg.scale(1)
      const ceScale = Math.min((entregaHalfWidth - 40) / ceDims.width, 55 / ceDims.height)
      page2.drawImage(firmaClienteEntregaImg, {
        x: margin + (entregaHalfWidth - ceDims.width * ceScale) / 2,
        y: ey - 70,
        width: ceDims.width * ceScale,
        height: ceDims.height * ceScale,
      })
    } catch (e) {
      console.error("Error embedding client delivery signature:", e)
    }

    page2.drawLine({ start: { x: margin + 20, y: ey - 55 }, end: { x: margin + entregaHalfWidth - 20, y: ey - 55 }, thickness: 1, color: grayColor })
    page2.drawText(safe(data.cliente.nombre).substring(0, 25), { x: margin + 30, y: ey - 70, size: 8, font: helvetica, color: textColor })

    // Firma Encargado Entrega
    page2.drawRectangle({ x: entregaCardX2, y: ey - 85, width: entregaHalfWidth, height: 100, color: bgGray, borderColor: lightGray, borderWidth: 1 })
    page2.drawRectangle({ x: entregaCardX2, y: ey + 5, width: entregaHalfWidth, height: 18, color: rgb(0.95, 0.95, 0.95) })
    page2.drawText("ENCARGADO (quien entrega)", { x: entregaCardX2 + 12, y: ey + 10, size: 8, font: helveticaBold, color: grayColor })

    if (data.firmaEncargadoEntrega) {
      try {
        const firmaEncargadoBytes = Uint8Array.from(atob(data.firmaEncargadoEntrega), c => c.charCodeAt(0))
        const firmaEncargadoImg = await pdfDoc.embedPng(firmaEncargadoBytes)
        const eeDims = firmaEncargadoImg.scale(1)
        const eeScale = Math.min((entregaHalfWidth - 40) / eeDims.width, 55 / eeDims.height)
        page2.drawImage(firmaEncargadoImg, {
          x: entregaCardX2 + (entregaHalfWidth - eeDims.width * eeScale) / 2,
          y: ey - 70,
          width: eeDims.width * eeScale,
          height: eeDims.height * eeScale,
        })
      } catch (e) {
        console.error("Error embedding employee delivery signature:", e)
      }
    }

    page2.drawLine({ start: { x: entregaCardX2 + 20, y: ey - 55 }, end: { x: entregaCardX2 + entregaHalfWidth - 20, y: ey - 55 }, thickness: 1, color: grayColor })
    page2.drawText(safe(data.entregadoPor).substring(0, 25), { x: entregaCardX2 + 30, y: ey - 70, size: 8, font: helvetica, color: textColor })

    // Footer pagina 2
    page2.drawText(`Orden #${numeroOrden} - Comprobante de Entrega`, { x: margin, y: 25, size: 8, font: helveticaBold, color: primaryColor })
    page2.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 100, y: 25, size: 7, font: helvetica, color: grayColor })
    page2.drawRectangle({ x: 0, y: 0, width, height: 8, color: primaryColor })
  }

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// COMPROBANTE DE VENTA
// ========================================

interface VentaItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  diasGarantia: number
}

interface VentaPDFData {
  numeroVenta: number
  fecha: Date
  cliente: {
    nombre: string
    telefono?: string | null
  }
  vendedor: string
  items: VentaItem[]
  subtotal: number
  descuento: number
  total: number
  metodoPago: string
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
}

export async function generateVentaPDF(data: VentaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  // Extraer datos
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroVenta = data.numeroVenta
  const fecha = formatDatePDF(data.fecha)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const vendedor = safe(data.vendedor)
  const metodoPago = metodoPagoLabels[data.metodoPago] || data.metodoPago

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Colores modernos (Indigo theme)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const primaryDark = rgb(0.118, 0.106, 0.294) // #1e1b4b
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const white = rgb(1, 1, 1)
  const greenColor = rgb(0.134, 0.545, 0.373)

  const margin = 40
  const contentWidth = width - (margin * 2)

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({
    x: 0,
    y: height - 10,
    width: width,
    height: 10,
    color: primaryColor,
  })

  let y = height - margin - 20

  // === LOGO (si existe) ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)

        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""

        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }

        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 50
          const maxLogoWidth = 80
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          page.drawImage(logoImage, {
            x: margin,
            y: height - margin - 10 - scaledHeight,
            width: scaledWidth,
            height: scaledHeight,
          })

          logoWidth = scaledWidth + 15
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 20, font: helveticaBold, color: textColor })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }

  // Numero de venta (lado derecho)
  const ventaText = `VENTA #${String(numeroVenta).padStart(4, "0")}`
  const ventaWidth = helveticaBold.widthOfTextAtSize(ventaText, 16)
  page.drawRectangle({
    x: width - margin - ventaWidth - 20,
    y: height - margin - 35,
    width: ventaWidth + 16,
    height: 26,
    color: primaryColor,
  })
  page.drawText(ventaText, {
    x: width - margin - ventaWidth - 12,
    y: height - margin - 27,
    size: 16,
    font: helveticaBold,
    color: white
  })
  page.drawText(`Fecha: ${fecha}`, {
    x: width - margin - 90,
    y: height - margin - 55,
    size: 9,
    font: helvetica,
    color: grayColor
  })

  y = height - margin - 90

  // Linea separadora
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: primaryColor })
  y -= 20

  // === TITULO ===
  const titleText = "COMPROBANTE DE VENTA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: primaryColor })
  y -= 30

  // === DATOS DEL CLIENTE ===
  page.drawRectangle({ x: margin, y: y - 40, width: contentWidth / 2 - 10, height: 50, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 10, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(clienteNombre, { x: margin + 10, y: y - 20, size: 10, font: helvetica, color: textColor })
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: y - 33, size: 9, font: helvetica, color: grayColor })
  }

  // === DATOS DEL VENDEDOR ===
  page.drawRectangle({ x: margin + contentWidth / 2 + 10, y: y - 40, width: contentWidth / 2 - 10, height: 50, color: bgGray })
  page.drawText("VENDEDOR", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(vendedor, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
  page.drawText(`Pago: ${metodoPago}`, { x: margin + contentWidth / 2 + 20, y: y - 33, size: 9, font: helvetica, color: grayColor })

  y -= 60

  // === TABLA DE ITEMS ===
  page.drawText("DETALLE DE PRODUCTOS", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Header de tabla (moderno con color primario)
  page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
  page.drawText("Descripcion", { x: margin + 10, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("Cant.", { x: margin + 280, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("P. Unit.", { x: margin + 330, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("Subtotal", { x: margin + 410, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("Garantia", { x: margin + 475, y: y, size: 9, font: helveticaBold, color: white })
  y -= 25

  // Filas de items
  for (const item of data.items) {
    page.drawText(item.descripcion.substring(0, 40), { x: margin + 10, y, size: 9, font: helvetica, color: textColor })
    page.drawText(String(item.cantidad), { x: margin + 285, y, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.precioUnitario), { x: margin + 330, y, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.subtotal), { x: margin + 410, y, size: 9, font: helvetica, color: textColor })
    page.drawText(item.diasGarantia > 0 ? `${item.diasGarantia} dias` : "-", { x: margin + 478, y, size: 9, font: helvetica, color: item.diasGarantia > 0 ? greenColor : grayColor })
    y -= 18
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })
  }

  y -= 20

  // === TOTALES ===
  const totalsX = width - margin - 180

  page.drawText("Subtotal:", { x: totalsX, y, size: 10, font: helvetica, color: grayColor })
  page.drawText(formatCurrencyPDF(data.subtotal), { x: totalsX + 100, y, size: 10, font: helvetica, color: textColor })
  y -= 18

  if (data.descuento > 0) {
    page.drawText("Descuento:", { x: totalsX, y, size: 10, font: helvetica, color: grayColor })
    page.drawText(`-${formatCurrencyPDF(data.descuento)}`, { x: totalsX + 100, y, size: 10, font: helvetica, color: rgb(0.8, 0.2, 0.2) })
    y -= 18
  }

  page.drawLine({ start: { x: totalsX, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 1, color: primaryColor })
  y -= 5

  page.drawText("TOTAL:", { x: totalsX, y, size: 12, font: helveticaBold, color: textColor })
  page.drawText(formatCurrencyPDF(data.total), { x: totalsX + 100, y, size: 12, font: helveticaBold, color: primaryColor })

  // === FOOTER ===
  const footerY = margin + 60

  page.drawLine({ start: { x: margin, y: footerY }, end: { x: width - margin, y: footerY }, thickness: 1, color: lightGray })

  page.drawText("Conserve este comprobante como prueba de compra.", { x: margin, y: footerY - 15, size: 8, font: helvetica, color: grayColor })
  page.drawText("Los productos con garantia incluyen certificado por separado.", { x: margin, y: footerY - 27, size: 8, font: helvetica, color: grayColor })
  page.drawText("Gracias por su compra!", { x: margin, y: footerY - 42, size: 9, font: helveticaBold, color: primaryColor })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 42, size: 7, font: helvetica, color: grayColor })

  // Barra inferior de acento
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: 8,
    color: primaryColor,
  })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// CERTIFICADO DE GARANTIA DE VENTA
// ========================================

interface GarantiaVentaPDFData {
  numeroGarantia: string
  venta: {
    numeroVenta: number
    fecha: Date
  }
  cliente: {
    nombre: string
    telefono?: string | null
  }
  item: {
    descripcion: string
    cantidad: number
    marca?: string | null
  }
  diasValidez: number
  fechaInicio: Date
  fechaVencimiento: Date
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  firmaEncargado?: string | null
  firmaEncargadoMime?: string | null
  nombreEncargado?: string | null
}

export async function generateGarantiaVentaPDF(data: GarantiaVentaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    if (!date) return ""
    const d = new Date(date)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric", timeZone: data.zonaHoraria || DEFAULT_TIMEZONE })
  }

  // Extraer datos
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroGarantia = safe(data.numeroGarantia)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const productoDescripcion = safe(data.item?.descripcion)
  const productoCantidad = data.item?.cantidad || 1
  const fechaInicio = formatDatePDF(data.fechaInicio)
  const fechaVencimiento = formatDatePDF(data.fechaVencimiento)
  const numeroVenta = data.venta?.numeroVenta || 0
  const fechaVenta = formatDatePDF(data.venta?.fecha)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Colores vibrantes
  const primaryColor = rgb(0.227, 0.384, 0.835) // #3a62d5 - Azul vibrante
  const primaryLight = rgb(0.380, 0.533, 0.906) // #6188e7 - Azul claro
  const primaryDark = rgb(0.118, 0.227, 0.525) // #1e3a86 - Azul oscuro
  const accentGold = rgb(0.855, 0.647, 0.125) // #daa520 - Dorado
  const accentGoldLight = rgb(1, 0.843, 0.4) // #ffd766 - Dorado claro
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.918, 0.929, 0.941) // #eaecf0
  const greenColor = rgb(0.086, 0.608, 0.420) // #169b6b
  const greenDark = rgb(0.047, 0.408, 0.286) // #0c6849
  const greenLight = rgb(0.812, 0.949, 0.886) // #cff2e2
  const white = rgb(1, 1, 1)

  const margin = 40
  const contentWidth = width - (margin * 2)

  // === FONDO DECORATIVO SUPERIOR ===
  // Banda superior gruesa con gradiente visual
  page.drawRectangle({
    x: 0,
    y: height - 120,
    width: width,
    height: 120,
    color: primaryColor,
  })
  // Capa superpuesta para efecto
  page.drawRectangle({
    x: 0,
    y: height - 60,
    width: width,
    height: 60,
    color: primaryDark,
  })

  // === ESCUDO/BADGE DE GARANTIA (círculo decorativo) ===
  const badgeCenterX = width / 2
  const badgeCenterY = height - 90
  const badgeRadius = 45

  // Círculo exterior dorado
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: badgeRadius + 8,
    color: accentGold,
  })
  // Círculo interior azul
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: badgeRadius,
    color: primaryDark,
  })
  // Círculo interior más pequeño
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: badgeRadius - 8,
    borderColor: accentGoldLight,
    borderWidth: 2,
  })

  // Texto dentro del badge
  const checkText = "OK"
  const checkWidth = helveticaBold.widthOfTextAtSize(checkText, 28)
  page.drawText(checkText, {
    x: badgeCenterX - checkWidth / 2,
    y: badgeCenterY - 10,
    size: 28,
    font: helveticaBold,
    color: accentGoldLight,
  })

  // === LOGO (esquina superior izquierda) ===
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)

        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""

        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }

        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 40
          const maxLogoWidth = 60
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          // Fondo blanco para el logo
          page.drawRectangle({
            x: margin - 5,
            y: height - 45 - scaledHeight / 2,
            width: scaledWidth + 10,
            height: scaledHeight + 10,
            color: white,
          })

          page.drawImage(logoImage, {
            x: margin,
            y: height - 40 - scaledHeight / 2,
            width: scaledWidth,
            height: scaledHeight,
          })
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === TITULO PRINCIPAL ===
  let y = height - 150

  const titleText = "CERTIFICADO DE GARANTIA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 22)
  page.drawText(titleText, {
    x: (width - titleWidth) / 2,
    y,
    size: 22,
    font: helveticaBold,
    color: primaryDark,
  })

  y -= 20

  // Línea decorativa dorada debajo del título
  const lineWidth = 160
  page.drawRectangle({
    x: (width - lineWidth) / 2,
    y,
    width: lineWidth,
    height: 2.5,
    color: accentGold,
  })

  y -= 25

  // === NUMERO DE GARANTIA (badge destacado) ===
  const garantiaText = `N° ${numeroGarantia}`
  const garantiaTextWidth = helveticaBold.widthOfTextAtSize(garantiaText, 13)
  const garantiaBadgeWidth = garantiaTextWidth + 36
  const garantiaBadgeHeight = 26

  page.drawRectangle({
    x: (width - garantiaBadgeWidth) / 2,
    y: y - 4,
    width: garantiaBadgeWidth,
    height: garantiaBadgeHeight,
    color: primaryColor,
    borderColor: primaryDark,
    borderWidth: 1,
  })
  page.drawText(garantiaText, {
    x: (width - garantiaTextWidth) / 2,
    y: y + 3,
    size: 13,
    font: helveticaBold,
    color: white,
  })

  y -= 45

  // === INFORMACIÓN DE LA EMPRESA ===
  page.drawText(empresaNombre.toUpperCase(), {
    x: margin,
    y,
    size: 12,
    font: helveticaBold,
    color: textColor,
  })
  y -= 14
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin, y, size: 9, font: helvetica, color: grayColor })
    if (direccionEmpresa) {
      page.drawText(`  |  ${direccionEmpresa}`, { x: margin + helvetica.widthOfTextAtSize(`Tel: ${telefonoEmpresa}`, 9), y, size: 9, font: helvetica, color: grayColor })
    }
  } else if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin, y, size: 9, font: helvetica, color: grayColor })
  }

  y -= 30

  // === SECCIÓN: DATOS DEL CLIENTE ===
  // Header de sección con icono
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: 4,
    height: 16,
    color: primaryColor,
  })
  page.drawText("DATOS DEL CLIENTE", { x: margin + 12, y, size: 11, font: helveticaBold, color: primaryDark })
  y -= 8
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Contenido del cliente en caja
  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: contentWidth,
    height: 50,
    color: rgb(0.976, 0.980, 0.988),
    borderColor: lightGray,
    borderWidth: 1,
  })

  page.drawText("Nombre:", { x: margin + 15, y: y - 5, size: 9, font: helvetica, color: grayColor })
  page.drawText(clienteNombre, { x: margin + 65, y: y - 5, size: 10, font: helveticaBold, color: textColor })
  if (clienteTelefono) {
    page.drawText("Telefono:", { x: margin + 280, y: y - 5, size: 9, font: helvetica, color: grayColor })
    page.drawText(clienteTelefono, { x: margin + 335, y: y - 5, size: 10, font: helvetica, color: textColor })
  }
  page.drawText("Venta N°:", { x: margin + 15, y: y - 22, size: 9, font: helvetica, color: grayColor })
  page.drawText(`${String(numeroVenta).padStart(4, "0")}`, { x: margin + 65, y: y - 22, size: 10, font: helveticaBold, color: textColor })
  page.drawText("Fecha:", { x: margin + 150, y: y - 22, size: 9, font: helvetica, color: grayColor })
  page.drawText(fechaVenta, { x: margin + 190, y: y - 22, size: 10, font: helvetica, color: textColor })

  y -= 55

  // === SECCIÓN: PRODUCTO CUBIERTO ===
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: 4,
    height: 16,
    color: primaryColor,
  })
  page.drawText("PRODUCTO CUBIERTO POR LA GARANTIA", { x: margin + 12, y, size: 11, font: helveticaBold, color: primaryDark })
  y -= 8
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: contentWidth,
    height: 50,
    color: rgb(0.976, 0.980, 0.988),
    borderColor: lightGray,
    borderWidth: 1,
  })

  page.drawText("Producto:", { x: margin + 15, y: y - 5, size: 9, font: helvetica, color: grayColor })
  // Truncar descripción si es muy larga
  let descripcionDisplay = productoDescripcion
  const maxDescWidth = 380
  while (helvetica.widthOfTextAtSize(descripcionDisplay, 10) > maxDescWidth && descripcionDisplay.length > 3) {
    descripcionDisplay = descripcionDisplay.slice(0, -4) + "..."
  }
  page.drawText(descripcionDisplay, { x: margin + 65, y: y - 5, size: 10, font: helveticaBold, color: textColor })
  page.drawText("Cantidad:", { x: margin + 15, y: y - 22, size: 9, font: helvetica, color: grayColor })
  page.drawText(String(productoCantidad), { x: margin + 65, y: y - 22, size: 10, font: helveticaBold, color: textColor })

  y -= 60

  // === SECCIÓN DESTACADA: VIGENCIA DE LA GARANTIA ===
  const vigenciaHeight = 110
  // Fondo verde con borde
  page.drawRectangle({
    x: margin,
    y: y - vigenciaHeight + 15,
    width: contentWidth,
    height: vigenciaHeight,
    color: greenLight,
    borderColor: greenColor,
    borderWidth: 2,
  })

  // Badge "VIGENTE" en esquina
  const vigenteBadgeWidth = 70
  page.drawRectangle({
    x: width - margin - vigenteBadgeWidth,
    y: y + 5,
    width: vigenteBadgeWidth,
    height: 22,
    color: greenColor,
  })
  const vigenteText = "VIGENTE"
  const vigenteWidth = helveticaBold.widthOfTextAtSize(vigenteText, 9)
  page.drawText(vigenteText, {
    x: width - margin - vigenteBadgeWidth / 2 - vigenteWidth / 2,
    y: y + 11,
    size: 9,
    font: helveticaBold,
    color: white,
  })

  // Título de la sección
  page.drawText("VIGENCIA DE LA GARANTIA", { x: margin + 20, y: y - 5, size: 12, font: helveticaBold, color: greenDark })
  y -= 35

  // Días grandes en el centro
  const diasText = `${data.diasValidez}`
  const diasWidth = helveticaBold.widthOfTextAtSize(diasText, 48)
  page.drawText(diasText, { x: (width - diasWidth) / 2 - 30, y: y - 5, size: 48, font: helveticaBold, color: greenDark })
  page.drawText("DIAS", { x: (width + diasWidth) / 2 - 20, y: y + 5, size: 16, font: helveticaBold, color: greenDark })

  y -= 45

  // Fechas con iconos visuales
  const fechaBoxWidth = (contentWidth - 40) / 2

  // Fecha inicio
  page.drawRectangle({
    x: margin + 10,
    y: y - 25,
    width: fechaBoxWidth,
    height: 35,
    color: white,
    borderColor: greenColor,
    borderWidth: 1,
  })
  page.drawText("DESDE", { x: margin + 20, y: y - 5, size: 8, font: helveticaBold, color: greenColor })
  page.drawText(fechaInicio, { x: margin + 20, y: y - 18, size: 10, font: helveticaBold, color: textColor })

  // Fecha fin
  page.drawRectangle({
    x: margin + 20 + fechaBoxWidth,
    y: y - 25,
    width: fechaBoxWidth,
    height: 35,
    color: white,
    borderColor: greenColor,
    borderWidth: 1,
  })
  page.drawText("HASTA", { x: margin + 30 + fechaBoxWidth, y: y - 5, size: 8, font: helveticaBold, color: greenColor })
  page.drawText(fechaVencimiento, { x: margin + 30 + fechaBoxWidth, y: y - 18, size: 10, font: helveticaBold, color: textColor })

  y -= 55

  // === CONDICIONES (más compactas) ===
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: 4,
    height: 16,
    color: grayColor,
  })
  page.drawText("CONDICIONES DE LA GARANTIA", { x: margin + 12, y, size: 10, font: helveticaBold, color: grayColor })
  y -= 18

  const condiciones = [
    "Esta garantia cubre defectos de fabricacion del producto.",
    "No cubre danos por mal uso, caidas, liquidos o manipulacion inadecuada.",
    "Para hacer efectiva la garantia, presente este certificado y el producto.",
    "La garantia no es transferible. El producto sera reparado o reemplazado segun disponibilidad.",
  ]

  for (let i = 0; i < condiciones.length; i++) {
    // Bullet point
    page.drawCircle({ x: margin + 8, y: y + 3, size: 2, color: grayColor })
    page.drawText(condiciones[i], { x: margin + 18, y, size: 8, font: helvetica, color: grayColor })
    y -= 12
  }

  // === FIRMA DEL ENCARGADO ===
  y -= 10

  // Embed signature image if available
  if (data.firmaEncargado) {
    try {
      const sigBytes = Buffer.from(data.firmaEncargado, "base64")
      const sigUint8 = new Uint8Array(sigBytes)
      let sigImage
      const sigMime = data.firmaEncargadoMime || "image/png"
      if (sigMime.includes("png")) {
        sigImage = await pdfDoc.embedPng(sigUint8)
      } else {
        sigImage = await pdfDoc.embedJpg(sigUint8)
      }
      if (sigImage) {
        const sigDims = sigImage.scale(1)
        const maxSigH = 50
        const maxSigW = 150
        const sigScale = Math.min(maxSigH / sigDims.height, maxSigW / sigDims.width)
        const sigW = sigDims.width * sigScale
        const sigH = sigDims.height * sigScale
        const sigX = width - margin - 90 - sigW / 2
        page.drawImage(sigImage, { x: sigX, y: y - sigH + 5, width: sigW, height: sigH })
        y -= sigH
      }
    } catch (sigError) {
      console.error("Error embedding signature:", sigError)
    }
  }

  page.drawLine({ start: { x: width - margin - 180, y }, end: { x: width - margin, y }, thickness: 1, color: textColor })
  const firmaLabel = data.nombreEncargado ? `Firma - ${data.nombreEncargado}` : "Firma"
  const firmaLabelWidth = helvetica.widthOfTextAtSize(firmaLabel, 9)
  page.drawText(firmaLabel, { x: width - margin - 90 - firmaLabelWidth / 2, y: y - 12, size: 9, font: helvetica, color: grayColor })

  // === FOOTER ===
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: 35,
    color: primaryDark,
  })

  const footerText = "Conserve este certificado junto con su comprobante de compra"
  const footerTextWidth = helvetica.widthOfTextAtSize(footerText, 9)
  page.drawText(footerText, {
    x: (width - footerTextWidth) / 2,
    y: 18,
    size: 9,
    font: helvetica,
    color: rgb(0.8, 0.8, 0.85),
  })

  const fechaImpresion = formatDateValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Emitido: ${fechaImpresion}`, { x: width - margin - 80, y: 8, size: 7, font: helvetica, color: rgb(0.6, 0.6, 0.65) })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// COMPROBANTE DE ENTREGA
// ========================================

interface ComprobanteEntregaPDFData {
  numeroOrden: number
  codigoOrden?: string | null
  fechaIngreso: Date
  fechaEntrega: Date
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
  }
  dispositivo: string
  tipoDispositivo: string
  marca?: string | null
  problemaReportado: string
  diagnostico?: string | null
  // Firmas
  firmaClienteEntrega: string // base64
  firmaClienteMime: string
  firmaEncargadoEntrega: string // base64
  firmaEncargadoMime: string
  entregadoPor: string // nombre del usuario
  notasEntrega?: string | null
  // Empresa
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

export async function generateComprobanteEntregaPDF(data: ComprobanteEntregaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatDateTimePDF = (date: Date | string | null | undefined): string => {
    return formatDateTimeValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  // Extraer datos
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroOrden = data.numeroOrden
  const codigoOrden = safe(data.codigoOrden)
  const fechaIngreso = formatDatePDF(data.fechaIngreso)
  const fechaEntrega = formatDateTimePDF(data.fechaEntrega)
  const clienteNombre = safe(data.cliente?.nombre) || "Sin nombre"
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const dispositivo = safe(data.dispositivo)
  const tipoDispositivo = safe(data.tipoDispositivo)
  const marca = safe(data.marca)
  const problemaReportado = safe(data.problemaReportado)
  const diagnostico = safe(data.diagnostico)
  const entregadoPor = safe(data.entregadoPor)
  const notasEntrega = safe(data.notasEntrega)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Colores modernos (Indigo theme)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const greenColor = rgb(0.134, 0.545, 0.373)
  const greenBg = rgb(0.863, 0.949, 0.898)
  const white = rgb(1, 1, 1)

  const margin = 40
  const contentWidth = width - (margin * 2)
  const cardGap = 10
  const halfWidth = (contentWidth - cardGap) / 2

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: greenColor })

  let y = height - margin - 15

  // === LOGO (si existe) ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)
        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""
        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }
        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 45
          const maxLogoWidth = 60
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale
          page.drawImage(logoImage, { x: margin, y: y - scaledHeight + 5, width: scaledWidth, height: scaledHeight })
          logoWidth = scaledWidth + 12
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER - Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 18, font: helveticaBold, color: textColor })
  y -= 14
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 11
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
  }

  // === BADGE ENTREGA (lado derecho) ===
  const badgeText = "ENTREGA"
  const badgeWidth = helveticaBold.widthOfTextAtSize(badgeText, 10) + 20
  page.drawRectangle({ x: width - margin - badgeWidth, y: height - margin - 25, width: badgeWidth, height: 22, color: greenColor })
  page.drawText(badgeText, { x: width - margin - badgeWidth + 10, y: height - margin - 19, size: 10, font: helveticaBold, color: white })

  // Numero de orden grande
  const ordenDisplay = codigoOrden || `#${String(numeroOrden).padStart(4, "0")}`
  const ordenTextWidth = helveticaBold.widthOfTextAtSize(ordenDisplay, 20)
  page.drawText(ordenDisplay, { x: width - margin - ordenTextWidth, y: height - margin - 50, size: 20, font: helveticaBold, color: textColor })

  y = height - margin - 90

  // === TITULO ===
  const titleText = "COMPROBANTE DE ENTREGA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: greenColor })
  y -= 25

  // === GRID: CLIENTE | DISPOSITIVO ===
  const cardHeight = 70

  // Card Cliente
  page.drawRectangle({ x: margin, y: y - cardHeight, width: halfWidth, height: cardHeight, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 12, y: y - 12, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(clienteNombre.substring(0, 28), { x: margin + 12, y: y - 28, size: 10, font: helveticaBold, color: textColor })
  page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 12, y: y - 42, size: 9, font: helvetica, color: grayColor })
  if (clienteEmail) {
    page.drawText(clienteEmail.substring(0, 25), { x: margin + 12, y: y - 55, size: 8, font: helvetica, color: grayColor })
  }

  // Card Dispositivo
  const cardX2 = margin + halfWidth + cardGap
  page.drawRectangle({ x: cardX2, y: y - cardHeight, width: halfWidth, height: cardHeight, color: bgGray })
  page.drawText("DISPOSITIVO", { x: cardX2 + 12, y: y - 12, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(dispositivo.substring(0, 25), { x: cardX2 + 12, y: y - 28, size: 10, font: helveticaBold, color: textColor })
  page.drawText(tipoDispositivo, { x: cardX2 + 12, y: y - 42, size: 9, font: helvetica, color: grayColor })
  if (marca) {
    page.drawText(`Marca: ${marca}`, { x: cardX2 + 12, y: y - 55, size: 8, font: helvetica, color: grayColor })
  }

  y -= cardHeight + 15

  // === FECHAS ===
  page.drawRectangle({ x: margin, y: y - 35, width: contentWidth, height: 40, color: greenBg, borderColor: greenColor, borderWidth: 1 })
  page.drawText("Ingreso:", { x: margin + 15, y: y - 10, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(fechaIngreso, { x: margin + 65, y: y - 10, size: 10, font: helvetica, color: textColor })
  page.drawText("Entrega:", { x: margin + 200, y: y - 10, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(fechaEntrega, { x: margin + 250, y: y - 10, size: 10, font: helveticaBold, color: greenColor })
  page.drawText("Entregado por:", { x: margin + 15, y: y - 25, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(entregadoPor, { x: margin + 100, y: y - 25, size: 10, font: helvetica, color: textColor })

  y -= 55

  // === PROBLEMA / DIAGNOSTICO ===
  page.drawText("TRABAJO REALIZADO", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
  y -= 12

  page.drawRectangle({ x: margin, y: y - 50, width: contentWidth, height: 55, color: bgGray, borderColor: lightGray, borderWidth: 1 })
  page.drawText("Problema:", { x: margin + 10, y: y - 12, size: 8, font: helveticaBold, color: grayColor })
  page.drawText(problemaReportado.substring(0, 70), { x: margin + 60, y: y - 12, size: 9, font: helvetica, color: textColor })
  if (diagnostico) {
    page.drawText("Diagnostico:", { x: margin + 10, y: y - 28, size: 8, font: helveticaBold, color: grayColor })
    page.drawText(diagnostico.substring(0, 65), { x: margin + 70, y: y - 28, size: 9, font: helvetica, color: textColor })
  }

  y -= 70

  // === NOTAS DE ENTREGA (si hay) ===
  if (notasEntrega) {
    page.drawText("NOTAS DE ENTREGA", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
    y -= 12
    page.drawText(notasEntrega.substring(0, 80), { x: margin, y, size: 9, font: helvetica, color: textColor })
    y -= 20
  }

  // === SECCION DE FIRMAS ===
  y -= 10
  page.drawLine({ start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 }, thickness: 1, color: lightGray })

  page.drawText("FIRMAS DE CONFORMIDAD", { x: margin, y: y - 5, size: 10, font: helveticaBold, color: primaryColor })
  y -= 25

  // Incrustar firma del cliente
  const firmaClienteX = margin
  const firmaEncargadoX = margin + halfWidth + cardGap

  // Card Firma Cliente
  page.drawRectangle({ x: firmaClienteX, y: y - 100, width: halfWidth, height: 105, color: bgGray })
  page.drawText("CLIENTE (quien recibe)", { x: firmaClienteX + 12, y: y - 12, size: 8, font: helveticaBold, color: grayColor })

  // Incrustar imagen de firma del cliente
  try {
    const firmaClienteBytes = Uint8Array.from(atob(data.firmaClienteEntrega), c => c.charCodeAt(0))
    const firmaClienteImage = await pdfDoc.embedPng(firmaClienteBytes)
    const clienteDims = firmaClienteImage.scale(1)
    const clienteScale = Math.min(100 / clienteDims.width, 50 / clienteDims.height)
    page.drawImage(firmaClienteImage, {
      x: firmaClienteX + (halfWidth - clienteDims.width * clienteScale) / 2,
      y: y - 70,
      width: clienteDims.width * clienteScale,
      height: clienteDims.height * clienteScale,
    })
  } catch (e) {
    console.error("Error embedding client signature:", e)
  }

  page.drawLine({ start: { x: firmaClienteX + 20, y: y - 80 }, end: { x: firmaClienteX + halfWidth - 20, y: y - 80 }, thickness: 1, color: grayColor })
  page.drawText(clienteNombre.substring(0, 25), { x: firmaClienteX + 30, y: y - 92, size: 8, font: helvetica, color: textColor })

  // Card Firma Encargado
  page.drawRectangle({ x: firmaEncargadoX, y: y - 100, width: halfWidth, height: 105, color: bgGray })
  page.drawText("ENCARGADO (quien entrega)", { x: firmaEncargadoX + 12, y: y - 12, size: 8, font: helveticaBold, color: grayColor })

  // Incrustar imagen de firma del encargado
  try {
    const firmaEncargadoBytes = Uint8Array.from(atob(data.firmaEncargadoEntrega), c => c.charCodeAt(0))
    const firmaEncargadoImage = await pdfDoc.embedPng(firmaEncargadoBytes)
    const encargadoDims = firmaEncargadoImage.scale(1)
    const encargadoScale = Math.min(100 / encargadoDims.width, 50 / encargadoDims.height)
    page.drawImage(firmaEncargadoImage, {
      x: firmaEncargadoX + (halfWidth - encargadoDims.width * encargadoScale) / 2,
      y: y - 70,
      width: encargadoDims.width * encargadoScale,
      height: encargadoDims.height * encargadoScale,
    })
  } catch (e) {
    console.error("Error embedding staff signature:", e)
  }

  page.drawLine({ start: { x: firmaEncargadoX + 20, y: y - 80 }, end: { x: firmaEncargadoX + halfWidth - 20, y: y - 80 }, thickness: 1, color: grayColor })
  page.drawText(entregadoPor.substring(0, 25), { x: firmaEncargadoX + 30, y: y - 92, size: 8, font: helvetica, color: textColor })

  // === FOOTER ===
  const footerTop = 80
  page.drawRectangle({ x: margin, y: 25, width: contentWidth, height: footerTop - 20, color: bgGray })

  page.drawText("TERMINOS DE ENTREGA", { x: margin + 10, y: footerTop - 5, size: 7, font: helveticaBold, color: grayColor })
  const terminos = [
    "• Al firmar este documento, el cliente confirma haber recibido el equipo en condiciones satisfactorias.",
    "• La garantia del servicio aplica segun lo acordado. Consulte las condiciones especificas.",
    "• Conserve este comprobante como prueba de entrega del equipo.",
  ]
  let termY = footerTop - 18
  terminos.forEach(t => {
    page.drawText(t, { x: margin + 10, y: termY, size: 6, font: helvetica, color: grayColor })
    termY -= 10
  })

  page.drawText(`Orden ${ordenDisplay}`, { x: margin + 10, y: 30, size: 7, font: helveticaBold, color: greenColor })

  const fechaImpresion2 = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion2}`, { x: width - margin - 90, y: 30, size: 6, font: helvetica, color: grayColor })

  // === BARRA INFERIOR ===
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: greenColor })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// FACTURA (INVOICE) PDF
// ========================================

interface FacturaPago {
  monto: number
  metodoPago: string
  fecha: Date | string
  referencia?: string | null
  cuotas?: number | null
  recargoPorcentaje?: number | null
  montoOriginal?: number | null
}

interface FacturaPDFData {
  numeroFactura: string
  fecha: Date | string
  estadoPago: string
  cliente: {
    nombre: string
    telefono?: string | null
    email?: string | null
    direccion?: string | null
  }
  orden: {
    numeroOrden: number
    codigoOrden?: string | null
    dispositivo: string
  }
  subtotal: number
  iva: number
  total: number
  montoAbonado: number
  pagos: FacturaPago[]
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

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

export async function generateFacturaPDF(data: FacturaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroFactura = safe(data.numeroFactura)
  const fecha = formatDatePDF(data.fecha)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const clienteDireccion = safe(data.cliente?.direccion)
  const ordenDisplay = data.orden.codigoOrden || `#${String(data.orden.numeroOrden).padStart(4, "0")}`
  const dispositivo = safe(data.orden.dispositivo)
  const pendiente = data.total - (data.montoAbonado || 0)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Colores (mismo theme indigo)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const primaryDark = rgb(0.118, 0.106, 0.294) // #1e1b4b
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const white = rgb(1, 1, 1)
  const greenColor = rgb(0.134, 0.545, 0.373)
  const redColor = rgb(0.8, 0.2, 0.2)
  const orangeColor = rgb(0.85, 0.55, 0.1)

  const margin = 40
  const contentWidth = width - (margin * 2)

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: primaryColor })

  let y = height - margin - 20

  // === LOGO ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)

        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""

        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }

        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 50
          const maxLogoWidth = 80
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          page.drawImage(logoImage, {
            x: margin,
            y: height - margin - 10 - scaledHeight,
            width: scaledWidth,
            height: scaledHeight,
          })

          logoWidth = scaledWidth + 15
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER: Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 20, font: helveticaBold, color: textColor })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }

  // Badge de factura (lado derecho)
  const facturaText = `FACTURA ${numeroFactura}`
  const facturaTextWidth = helveticaBold.widthOfTextAtSize(facturaText, 14)
  page.drawRectangle({
    x: width - margin - facturaTextWidth - 24,
    y: height - margin - 35,
    width: facturaTextWidth + 20,
    height: 26,
    color: primaryColor,
  })
  page.drawText(facturaText, {
    x: width - margin - facturaTextWidth - 14,
    y: height - margin - 27,
    size: 14,
    font: helveticaBold,
    color: white,
  })
  page.drawText(`Fecha: ${fecha}`, {
    x: width - margin - 100,
    y: height - margin - 55,
    size: 9,
    font: helvetica,
    color: grayColor,
  })

  y = height - margin - 90

  // Linea separadora
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: primaryColor })
  y -= 20

  // === TITULO ===
  const titleText = "FACTURA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: primaryColor })
  y -= 30

  // === DATOS DEL CLIENTE ===
  const clientBoxHeight = 60
  page.drawRectangle({ x: margin, y: y - clientBoxHeight + 10, width: contentWidth / 2 - 10, height: clientBoxHeight, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 10, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(clienteNombre, { x: margin + 10, y: y - 20, size: 10, font: helvetica, color: textColor })
  let clientY = y - 33
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: clientY, size: 9, font: helvetica, color: grayColor })
    clientY -= 12
  }
  if (clienteEmail) {
    page.drawText(clienteEmail, { x: margin + 10, y: clientY, size: 9, font: helvetica, color: grayColor })
  }

  // === DATOS DE LA ORDEN ===
  page.drawRectangle({ x: margin + contentWidth / 2 + 10, y: y - clientBoxHeight + 10, width: contentWidth / 2 - 10, height: clientBoxHeight, color: bgGray })
  page.drawText("ORDEN DE SERVICIO", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(`Orden: ${ordenDisplay}`, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
  page.drawText(`Dispositivo: ${dispositivo}`, { x: margin + contentWidth / 2 + 20, y: y - 33, size: 9, font: helvetica, color: grayColor })

  y -= clientBoxHeight + 15

  // === DETALLE DE MONTOS ===
  page.drawText("DETALLE", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Header de tabla
  page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
  page.drawText("Concepto", { x: margin + 10, y, size: 9, font: helveticaBold, color: white })
  page.drawText("Monto", { x: width - margin - 100, y, size: 9, font: helveticaBold, color: white })
  y -= 25

  // Subtotal
  page.drawText("Subtotal", { x: margin + 10, y, size: 10, font: helvetica, color: textColor })
  page.drawText(formatCurrencyPDF(data.subtotal), { x: width - margin - 100, y, size: 10, font: helvetica, color: textColor })
  y -= 18
  page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })

  // IVA
  if (data.iva > 0) {
    page.drawText("IVA", { x: margin + 10, y, size: 10, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(data.iva), { x: width - margin - 100, y, size: 10, font: helvetica, color: textColor })
    y -= 18
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })
  }

  // Linea antes del total
  y -= 5
  page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 1.5, color: primaryColor })
  y -= 5

  // Total
  page.drawRectangle({ x: margin, y: y - 8, width: contentWidth, height: 28, color: bgGray })
  page.drawText("TOTAL", { x: margin + 10, y, size: 12, font: helveticaBold, color: textColor })
  page.drawText(formatCurrencyPDF(data.total), { x: width - margin - 100, y, size: 12, font: helveticaBold, color: primaryColor })
  y -= 35

  // === ESTADO DE PAGO ===
  const estadoLabel = estadoPagoLabels[data.estadoPago] || data.estadoPago
  let estadoColor = grayColor
  if (data.estadoPago === "PAGADO") estadoColor = greenColor
  else if (data.estadoPago === "PENDIENTE") estadoColor = redColor
  else if (data.estadoPago === "PAGADO_PARCIAL") estadoColor = orangeColor
  else if (data.estadoPago === "ANULADA") estadoColor = redColor

  page.drawText("ESTADO DE PAGO", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Badge del estado
  const estadoBadgeWidth = helveticaBold.widthOfTextAtSize(estadoLabel, 11) + 20
  page.drawRectangle({ x: margin, y: y - 6, width: estadoBadgeWidth, height: 22, color: estadoColor })
  page.drawText(estadoLabel, { x: margin + 10, y: y, size: 11, font: helveticaBold, color: white })

  // Montos abonado y pendiente al lado
  const montoX = margin + estadoBadgeWidth + 30
  page.drawText(`Abonado: ${formatCurrencyPDF(data.montoAbonado)}`, { x: montoX, y: y + 2, size: 10, font: helvetica, color: greenColor })
  if (pendiente > 0 && data.estadoPago !== "ANULADA") {
    page.drawText(`Pendiente: ${formatCurrencyPDF(pendiente)}`, { x: montoX + 160, y: y + 2, size: 10, font: helveticaBold, color: redColor })
  }

  y -= 35

  // === HISTORIAL DE PAGOS ===
  if (data.pagos && data.pagos.length > 0) {
    page.drawText("HISTORIAL DE PAGOS", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
    y -= 5
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
    y -= 20

    // Header
    page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
    page.drawText("Fecha", { x: margin + 10, y, size: 9, font: helveticaBold, color: white })
    page.drawText("Metodo", { x: margin + 140, y, size: 9, font: helveticaBold, color: white })
    page.drawText("Referencia", { x: margin + 280, y, size: 9, font: helveticaBold, color: white })
    page.drawText("Monto", { x: width - margin - 90, y, size: 9, font: helveticaBold, color: white })
    y -= 25

    for (const pago of data.pagos) {
      const pagoFecha = formatDatePDF(pago.fecha)
      const pagoMetodo = metodoPagoFacturaLabels[pago.metodoPago] || pago.metodoPago
      const pagoRef = safe(pago.referencia)

      page.drawText(pagoFecha, { x: margin + 10, y, size: 9, font: helvetica, color: textColor })
      page.drawText(pagoMetodo, { x: margin + 140, y, size: 9, font: helvetica, color: textColor })
      if (pagoRef) {
        page.drawText(pagoRef.substring(0, 25), { x: margin + 280, y, size: 9, font: helvetica, color: grayColor })
      }
      page.drawText(formatCurrencyPDF(pago.monto), { x: width - margin - 90, y, size: 9, font: helveticaBold, color: greenColor })
      y -= 18
      page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })

      // Check if we need a new page
      if (y < margin + 80) {
        break
      }
    }
  }

  // === FOOTER ===
  const footerY = margin + 50

  page.drawLine({ start: { x: margin, y: footerY }, end: { x: width - margin, y: footerY }, thickness: 1, color: lightGray })

  page.drawText("Este documento es un comprobante interno de facturacion.", { x: margin, y: footerY - 15, size: 8, font: helvetica, color: grayColor })
  page.drawText("Conserve este comprobante para su registro.", { x: margin, y: footerY - 27, size: 8, font: helvetica, color: grayColor })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 27, size: 7, font: helvetica, color: grayColor })

  // Barra inferior
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: primaryColor })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// PDF DEVOLUCION (NOTA DE CREDITO)
// ========================================

interface DevolucionPDFData {
  numeroDevolucion: string
  fecha: Date | string
  ventaNumero: number
  motivo: string
  tipo: string
  observaciones?: string | null
  items: Array<{
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
  }>
  montoDevolucion: number
  cliente: {
    nombre: string
    telefono?: string | null
  }
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

export async function generateDevolucionPDF(data: DevolucionPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842])
  const { width, height } = page.getSize()
  const margin = 40

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const primaryColor = rgb(0.388, 0.400, 0.945)
  const primaryDark = rgb(0.118, 0.106, 0.294)
  const textColor = rgb(0.118, 0.161, 0.231)
  const grayColor = rgb(0.396, 0.455, 0.525)
  const redColor = rgb(0.863, 0.196, 0.184)
  const lightBg = rgb(0.969, 0.973, 0.984)

  let y = height - 8

  // Accent bar
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: primaryColor })
  y -= 40

  // Header
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Técnico"
  page.drawText(empresaNombre, { x: margin, y, size: 18, font: helveticaBold, color: primaryDark })

  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  if (telefonoEmpresa) {
    y -= 14
    page.drawText(telefonoEmpresa, { x: margin, y, size: 9, font: helvetica, color: grayColor })
  }
  if (direccionEmpresa) {
    y -= 12
    page.drawText(direccionEmpresa, { x: margin, y, size: 9, font: helvetica, color: grayColor })
  }

  // Badge
  const badgeW = 160
  const badgeH = 28
  const badgeX = width - margin - badgeW
  const badgeY = height - 48
  page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: redColor })
  page.drawText("NOTA DE CRÉDITO", { x: badgeX + 20, y: badgeY + 9, size: 11, font: helveticaBold, color: rgb(1, 1, 1) })

  page.drawText(data.numeroDevolucion, { x: badgeX, y: badgeY - 16, size: 10, font: helveticaBold, color: textColor })
  page.drawText(`Fecha: ${formatDatePDF(data.fecha)}`, { x: badgeX, y: badgeY - 30, size: 9, font: helvetica, color: grayColor })

  y -= 30

  // Separator
  page.drawRectangle({ x: margin, y, width: width - margin * 2, height: 1, color: lightBg })
  y -= 25

  // Info section
  const col1X = margin
  const col2X = width / 2 + 20

  page.drawText("CLIENTE", { x: col1X, y, size: 8, font: helveticaBold, color: grayColor })
  page.drawText("REFERENCIA", { x: col2X, y, size: 8, font: helveticaBold, color: grayColor })
  y -= 14

  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  page.drawText(clienteNombre, { x: col1X, y, size: 10, font: helveticaBold, color: textColor })
  page.drawText(`Venta V${String(data.ventaNumero).padStart(4, "0")}`, { x: col2X, y, size: 10, font: helveticaBold, color: textColor })
  y -= 13

  if (data.cliente?.telefono) {
    page.drawText(safe(data.cliente.telefono), { x: col1X, y, size: 9, font: helvetica, color: grayColor })
  }
  page.drawText(`Tipo: ${data.tipo}`, { x: col2X, y, size: 9, font: helvetica, color: grayColor })
  y -= 13
  page.drawText(`Motivo: ${data.motivo}`, { x: col2X, y, size: 9, font: helvetica, color: grayColor })

  y -= 25

  // Items table header
  const tableW = width - margin * 2
  page.drawRectangle({ x: margin, y: y - 2, width: tableW, height: 22, color: primaryColor })

  const colWidths = [tableW * 0.5, tableW * 0.15, tableW * 0.15, tableW * 0.2]
  const colX = [margin + 8, margin + colWidths[0], margin + colWidths[0] + colWidths[1], margin + colWidths[0] + colWidths[1] + colWidths[2]]

  page.drawText("Producto", { x: colX[0], y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText("Cant.", { x: colX[1] + 10, y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText("Precio", { x: colX[2] + 5, y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText("Subtotal", { x: colX[3] + 5, y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })

  y -= 24

  // Items rows
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    if (i % 2 === 0) {
      page.drawRectangle({ x: margin, y: y - 4, width: tableW, height: 20, color: lightBg })
    }

    const desc = safe(item.descripcion).substring(0, 45)
    page.drawText(desc, { x: colX[0], y: y + 2, size: 9, font: helvetica, color: textColor })
    page.drawText(String(item.cantidad), { x: colX[1] + 15, y: y + 2, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.precioUnitario), { x: colX[2] + 5, y: y + 2, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.subtotal), { x: colX[3] + 5, y: y + 2, size: 9, font: helveticaBold, color: textColor })

    y -= 20
  }

  y -= 10

  // Total
  const totalBoxW = 200
  const totalBoxX = width - margin - totalBoxW
  page.drawRectangle({ x: totalBoxX, y: y - 5, width: totalBoxW, height: 30, color: rgb(0.95, 0.92, 0.92) })
  page.drawText("TOTAL DEVOLUCIÓN:", { x: totalBoxX + 10, y: y + 5, size: 10, font: helveticaBold, color: redColor })
  const totalText = formatCurrencyPDF(data.montoDevolucion)
  const totalTextW = helveticaBold.widthOfTextAtSize(totalText, 12)
  page.drawText(totalText, { x: totalBoxX + totalBoxW - totalTextW - 10, y: y + 3, size: 12, font: helveticaBold, color: redColor })

  y -= 30

  // Observaciones
  if (data.observaciones) {
    y -= 15
    page.drawText("Observaciones:", { x: margin, y, size: 9, font: helveticaBold, color: grayColor })
    y -= 13
    page.drawText(safe(data.observaciones).substring(0, 120), { x: margin, y, size: 9, font: helvetica, color: textColor })
  }

  // Footer
  const footerY = 40
  page.drawRectangle({ x: margin, y: footerY + 10, width: width - margin * 2, height: 1, color: lightBg })
  page.drawText("Este documento es una nota de crédito válida.", { x: margin, y: footerY - 5, size: 8, font: helvetica, color: grayColor })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 5, size: 7, font: helvetica, color: grayColor })

  // Bottom bar
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: redColor })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

export type { CotizacionPDFData, CotizacionItem, OrdenPDFData, VentaPDFData, VentaItem, GarantiaVentaPDFData, ComprobanteEntregaPDFData, FacturaPDFData, FacturaPago, DevolucionPDFData }
