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
  subtotal: number
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
  orden: {
    numeroOrden: number
    dispositivo: string
    problemaReportado: string
  }
  items: CotizacionItem[]
  subtotal: number
  iva: number
  total: number
  notas?: string | null
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  // Firma de aprobacion
  firmaAprobacion?: string | null
  firmaMime?: string | null
  fechaAprobacion?: Date | null
}

const formatCurrency = (amount: number | string | null | undefined) => {
  if (amount === null || amount === undefined) return ""
  const numericAmount = typeof amount === "string" ? Number(amount) : amount
  if (Number.isNaN(numericAmount)) return ""
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
    numericAmount
  )
}

const formatDate = (date: Date | string | number | null | undefined) => {
  if (!date) return ""
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ""

  return parsed.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

// Ensure we never pass objects/React nodes into <Text>, which triggers React error #31
const toText = (val: unknown): string => {
  if (val === null || val === undefined || val === false) return ""
  if (React.isValidElement(val)) return ""
  if (Array.isArray(val)) {
    return val.map(v => toText(v)).join(", ")
  }
  if (typeof val === "object") {
    // Check for Date objects
    if (val instanceof Date) {
      return formatDate(val)
    }
    // Check for objects with $$typeof (React elements that slip through)
    if ("$$typeof" in val) return ""
    try {
      return JSON.stringify(val)
    } catch {
      return String(val)
    }
  }
  if (typeof val === "symbol") return val.toString()
  return String(val)
}

const CotizacionDocument = ({ data }: { data: CotizacionPDFData }) => {
  const companyName = toText(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = toText(data.telefonoEmpresa)
  const direccionEmpresa = toText(data.direccionEmpresa)
  const logoUrl = toText(data.logoUrl)
  const cotizacionNumber = toText(data.numeroCotizacion)
  const cotizacionDate = formatDate(data.fecha)
  const clienteNombre = toText(data.cliente.nombre)
  const clienteTelefono = toText(data.cliente.telefono)
  const clienteEmail = toText(data.cliente.email)
  const clienteDireccion = toText(data.cliente.direccion)
  const ordenNumero = toText(data.orden.numeroOrden)
  const dispositivo = toText(data.orden.dispositivo)
  const problemaReportado = toText(data.orden.problemaReportado)
  const notas = toText(data.notas)
  const fechaVencimiento = formatDate(data.fechaVencimiento)
  const firmaAprobacion = toText(data.firmaAprobacion)
  const firmaMime = toText(data.firmaMime)
  const fechaAprobacion = formatDate(data.fechaAprobacion)

  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", style: styles.page },
      // Barra de acento superior
      React.createElement(View, { style: styles.accentBar }),

      // Container principal
      React.createElement(View, { style: styles.container },
        // Header moderno
        React.createElement(View, { style: styles.header },
          React.createElement(View, { style: styles.headerLeft },
            logoUrl ? React.createElement(Image, { style: styles.logo, src: logoUrl }) : null,
            React.createElement(View, { style: styles.companyDetails },
              React.createElement(Text, { style: styles.companyName }, companyName),
              telefonoEmpresa ? React.createElement(Text, { style: styles.companyInfo }, `Tel: ${telefonoEmpresa}`) : null,
              direccionEmpresa ? React.createElement(Text, { style: styles.companyInfo }, direccionEmpresa) : null
            )
          ),
          React.createElement(View, { style: styles.headerRight },
            React.createElement(View, { style: styles.docBadge },
              React.createElement(Text, { style: styles.docBadgeText }, "COTIZACION")
            ),
            React.createElement(Text, { style: styles.docNumber }, cotizacionNumber),
            React.createElement(Text, { style: styles.docDate }, cotizacionDate)
          )
        ),

        // Grid de 2 columnas: Cliente y Orden
        React.createElement(View, { style: styles.twoColGrid },
          // Cliente Card
          React.createElement(View, { style: styles.gridCol },
            React.createElement(Text, { style: styles.cardTitle }, "Cliente"),
            React.createElement(View, { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardLabel }, "Nombre"),
              React.createElement(Text, { style: styles.cardValue }, clienteNombre)
            ),
            React.createElement(View, { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardLabel }, "Telefono"),
              React.createElement(Text, { style: styles.cardValue }, clienteTelefono)
            ),
            clienteEmail ? React.createElement(View, { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardLabel }, "Email"),
              React.createElement(Text, { style: styles.cardValue }, clienteEmail)
            ) : null,
            clienteDireccion ? React.createElement(View, { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardLabel }, "Direccion"),
              React.createElement(Text, { style: styles.cardValue }, clienteDireccion)
            ) : null
          ),
          // Orden Card
          React.createElement(View, { style: styles.gridCol },
            React.createElement(Text, { style: styles.cardTitle }, `Orden #${ordenNumero}`),
            React.createElement(View, { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardLabel }, "Equipo"),
              React.createElement(Text, { style: styles.cardValue }, dispositivo)
            ),
            React.createElement(View, { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardLabel }, "Problema"),
              React.createElement(Text, { style: styles.cardValue }, problemaReportado)
            )
          )
        ),

        // Tabla de items
        React.createElement(View, { style: styles.tableSection },
          React.createElement(Text, { style: styles.tableSectionTitle }, "Detalle de Servicios"),
          React.createElement(View, { style: styles.table },
            React.createElement(View, { style: styles.tableHeader },
              React.createElement(Text, { style: [styles.colDescription, styles.tableHeaderText] }, "Descripcion"),
              React.createElement(Text, { style: [styles.colQuantity, styles.tableHeaderText] }, "Cant."),
              React.createElement(Text, { style: [styles.colPrice, styles.tableHeaderText] }, "P. Unit."),
              React.createElement(Text, { style: [styles.colSubtotal, styles.tableHeaderText] }, "Subtotal")
            ),
            ...data.items.map((item, index) =>
              React.createElement(View, { key: index, style: index % 2 === 0 ? styles.tableRow : styles.tableRowAlt },
                React.createElement(Text, { style: styles.colDescription }, toText(item.descripcion)),
                React.createElement(Text, { style: styles.colQuantity }, toText(item.cantidad)),
                React.createElement(Text, { style: styles.colPrice }, formatCurrency(item.precioUnitario)),
                React.createElement(Text, { style: styles.colSubtotal }, formatCurrency(item.subtotal))
              )
            )
          )
        ),

        // Totales
        React.createElement(View, { style: styles.totalsContainer },
          React.createElement(View, { style: styles.totalsBox },
            React.createElement(View, { style: styles.totalRow },
              React.createElement(Text, { style: styles.totalLabel }, "Subtotal"),
              React.createElement(Text, { style: styles.totalValue }, formatCurrency(data.subtotal))
            ),
            data.iva > 0 ? React.createElement(View, { style: styles.totalRow },
              React.createElement(Text, { style: styles.totalLabel }, "IVA"),
              React.createElement(Text, { style: styles.totalValue }, formatCurrency(data.iva))
            ) : null,
            React.createElement(View, { style: styles.grandTotalRow },
              React.createElement(Text, { style: styles.grandTotalLabel }, "TOTAL"),
              React.createElement(Text, { style: styles.grandTotalValue }, formatCurrency(data.total))
            )
          )
        ),

        // Validez
        fechaVencimiento
          ? React.createElement(View, { style: styles.validityBanner },
              React.createElement(Text, { style: styles.validityText },
                `Cotizacion valida hasta el ${fechaVencimiento}`
              )
            )
          : null,

        // Notas
        notas
          ? React.createElement(View, { style: styles.notesCard },
              React.createElement(Text, { style: styles.notesTitle }, "Observaciones"),
              React.createElement(Text, { style: styles.notesText }, notas)
            )
          : null,

        // Firma (si esta aprobada)
        firmaAprobacion && firmaMime
          ? React.createElement(View, { style: styles.signatureSection },
              React.createElement(View, { style: styles.signatureContainer },
                React.createElement(View, { style: styles.signatureBox },
                  React.createElement(Image, {
                    style: styles.signatureImage,
                    src: `data:${firmaMime};base64,${firmaAprobacion}`,
                  }),
                  React.createElement(View, { style: styles.signatureLine }),
                  React.createElement(Text, { style: styles.signatureLabel }, "Firma del Cliente"),
                  fechaAprobacion ? React.createElement(Text, { style: styles.signatureDate },
                    `Aprobado: ${fechaAprobacion}`
                  ) : null
                )
              )
            )
          : null
      ),

      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, { style: styles.footerText },
          firmaAprobacion
            ? "Documento aprobado por el cliente"
            : "Gracias por su confianza"
        ),
        React.createElement(Text, { style: styles.footerBrand }, companyName)
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
  const fechaIngreso = formatDate(data.fechaIngreso)
  const fechaPrometida = formatDate(data.fechaPrometida)

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
      ? formatCurrency(data.presupuesto)
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
    if (!date) return ""
    const d = new Date(date)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined) return ""
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount)
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
  const fechaImpresion = new Date().toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  })

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

  // === SECCION DE FIRMAS ===
  const firmaY = terminosStartY - terminosBoxHeight - 45

  // Línea separadora
  page.drawLine({ start: { x: margin, y: firmaY + 30 }, end: { x: width - margin, y: firmaY + 30 }, thickness: 1, color: lightGray })

  // Firma Cliente
  page.drawRectangle({ x: margin, y: firmaY - 55, width: halfWidth, height: 70, color: bgGray, borderColor: lightGray, borderWidth: 1 })
  page.drawRectangle({ x: margin, y: firmaY + 5, width: halfWidth, height: 18, color: rgb(0.95, 0.95, 0.95) })
  page.drawText("FIRMA CLIENTE", { x: margin + 12, y: firmaY + 10, size: 8, font: helveticaBold, color: grayColor })
  page.drawLine({ start: { x: margin + 20, y: firmaY - 15 }, end: { x: margin + halfWidth - 20, y: firmaY - 15 }, thickness: 1, color: grayColor })
  page.drawText("Aclaracion: _________________________", { x: margin + 15, y: firmaY - 32, size: 7, font: helvetica, color: grayColor })
  page.drawText("DNI: _________________________", { x: margin + 15, y: firmaY - 45, size: 7, font: helvetica, color: grayColor })

  // Firma Tecnico
  page.drawRectangle({ x: cardX2, y: firmaY - 55, width: halfWidth, height: 70, color: bgGray, borderColor: lightGray, borderWidth: 1 })
  page.drawRectangle({ x: cardX2, y: firmaY + 5, width: halfWidth, height: 18, color: rgb(0.95, 0.95, 0.95) })
  page.drawText("FIRMA TECNICO", { x: cardX2 + 12, y: firmaY + 10, size: 8, font: helveticaBold, color: grayColor })
  page.drawLine({ start: { x: cardX2 + 20, y: firmaY - 15 }, end: { x: cardX2 + halfWidth - 20, y: firmaY - 15 }, thickness: 1, color: grayColor })
  page.drawText("Aclaracion: _________________________", { x: cardX2 + 15, y: firmaY - 32, size: 7, font: helvetica, color: grayColor })

  // === FOOTER ===
  page.drawText(`Orden #${numeroOrden}`, { x: margin, y: 25, size: 8, font: helveticaBold, color: primaryColor })
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 100, y: 25, size: 7, font: helvetica, color: grayColor })

  // === BARRA INFERIOR ===
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: primaryColor })

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
    if (!date) return ""
    const d = new Date(date)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined) return "$0"
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount)
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

  const fechaImpresion = new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
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
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
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
  let y = height - 155

  const titleText = "CERTIFICADO DE GARANTIA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 24)
  page.drawText(titleText, {
    x: (width - titleWidth) / 2,
    y,
    size: 24,
    font: helveticaBold,
    color: primaryDark,
  })

  y -= 25

  // Línea decorativa dorada debajo del título
  const lineWidth = 180
  page.drawRectangle({
    x: (width - lineWidth) / 2,
    y,
    width: lineWidth,
    height: 3,
    color: accentGold,
  })

  y -= 30

  // === NUMERO DE GARANTIA (badge destacado) ===
  const garantiaText = `N° ${numeroGarantia}`
  const garantiaTextWidth = helveticaBold.widthOfTextAtSize(garantiaText, 14)
  const garantiaBadgeWidth = garantiaTextWidth + 40
  const garantiaBadgeHeight = 28

  page.drawRectangle({
    x: (width - garantiaBadgeWidth) / 2,
    y: y - 5,
    width: garantiaBadgeWidth,
    height: garantiaBadgeHeight,
    color: primaryLight,
  })
  page.drawText(garantiaText, {
    x: (width - garantiaTextWidth) / 2,
    y: y + 3,
    size: 14,
    font: helveticaBold,
    color: white,
  })

  y -= 50

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

  // === FIRMA ===
  y -= 15
  page.drawLine({ start: { x: width - margin - 180, y }, end: { x: width - margin, y }, thickness: 1, color: textColor })
  page.drawText("Firma y Sello", { x: width - margin - 120, y: y - 12, size: 9, font: helvetica, color: grayColor })

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

  const fechaImpresion = new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
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
}

export async function generateComprobanteEntregaPDF(data: ComprobanteEntregaPDFData): Promise<Buffer> {
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
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  }

  const formatDateTimePDF = (date: Date | string | null | undefined): string => {
    if (!date) return ""
    const d = new Date(date)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
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

  const fechaImpresion = new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 90, y: 30, size: 6, font: helvetica, color: grayColor })

  // === BARRA INFERIOR ===
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: greenColor })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

export type { CotizacionPDFData, CotizacionItem, OrdenPDFData, VentaPDFData, VentaItem, GarantiaVentaPDFData, ComprobanteEntregaPDFData }
