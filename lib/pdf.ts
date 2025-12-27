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

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    paddingBottom: 20,
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
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
  },
  subtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  cotizacionNumber: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#3b82f6",
  },
  cotizacionDate: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#374151",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    width: 100,
    color: "#6b7280",
  },
  value: {
    flex: 1,
    color: "#1f2937",
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: 8,
    fontWeight: "bold",
    color: "#374151",
  },
  tableRow: {
    flexDirection: "row",
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  colDescription: {
    flex: 3,
  },
  colQuantity: {
    flex: 1,
    textAlign: "center",
  },
  colPrice: {
    flex: 1,
    textAlign: "right",
  },
  colSubtotal: {
    flex: 1,
    textAlign: "right",
  },
  totalsSection: {
    marginTop: 20,
    alignItems: "flex-end",
  },
  totalRow: {
    flexDirection: "row",
    width: 200,
    justifyContent: "space-between",
    marginBottom: 4,
  },
  totalLabel: {
    color: "#6b7280",
  },
  totalValue: {
    fontWeight: "bold",
  },
  grandTotal: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: "#3b82f6",
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1f2937",
  },
  grandTotalValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#3b82f6",
  },
  notes: {
    marginTop: 30,
    padding: 15,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  notesTitle: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#374151",
    marginBottom: 4,
  },
  notesText: {
    fontSize: 10,
    color: "#6b7280",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 9,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
  validity: {
    marginTop: 20,
    padding: 10,
    backgroundColor: "#fef3c7",
    borderRadius: 4,
  },
  validityText: {
    fontSize: 10,
    color: "#92400e",
    textAlign: "center",
  },
  signatureSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  signatureContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  signatureBox: {
    width: 200,
    alignItems: "center",
  },
  signatureImage: {
    maxWidth: 150,
    maxHeight: 60,
    marginBottom: 4,
  },
  signatureLine: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "#374151",
    marginTop: 4,
  },
  signatureLabel: {
    fontSize: 9,
    color: "#6b7280",
    marginTop: 4,
    textAlign: "center",
  },
  signatureDate: {
    fontSize: 8,
    color: "#9ca3af",
    marginTop: 2,
    textAlign: "center",
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
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(View, { style: styles.headerLeft },
          React.createElement(Text, { style: styles.title }, companyName),
          React.createElement(Text, { style: styles.subtitle }, "Cotizacion de Servicios")
        ),
        React.createElement(View, { style: styles.headerRight },
          React.createElement(Text, { style: styles.cotizacionNumber }, cotizacionNumber),
          React.createElement(Text, { style: styles.cotizacionDate }, `Fecha: ${cotizacionDate}`)
        )
      ),

      // Cliente Section
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Datos del Cliente"),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Nombre:"),
          React.createElement(Text, { style: styles.value }, clienteNombre)
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Telefono:"),
          React.createElement(Text, { style: styles.value }, clienteTelefono)
        ),
        clienteEmail && React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Email:"),
          React.createElement(Text, { style: styles.value }, clienteEmail)
        ),
        clienteDireccion && React.createElement(View, { style: styles.row },
              React.createElement(Text, { style: styles.label }, "Direccion:"),
          React.createElement(Text, { style: styles.value }, clienteDireccion)
        )
      ),

      // Orden Section
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, `Orden de Servicio #${ordenNumero}`),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Dispositivo:"),
          React.createElement(Text, { style: styles.value }, dispositivo)
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Problema:"),
          React.createElement(Text, { style: styles.value }, problemaReportado)
        )
      ),

      // Items Table
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Detalle de la Cotizacion"),
        React.createElement(View, { style: styles.table },
          React.createElement(View, { style: styles.tableHeader },
            React.createElement(Text, { style: styles.colDescription }, "Descripcion"),
            React.createElement(Text, { style: styles.colQuantity }, "Cant."),
            React.createElement(Text, { style: styles.colPrice }, "P. Unit."),
            React.createElement(Text, { style: styles.colSubtotal }, "Subtotal")
          ),
          ...data.items.map((item, index) =>
            React.createElement(View, { key: index, style: styles.tableRow },
              React.createElement(Text, { style: styles.colDescription }, toText(item.descripcion)),
              React.createElement(Text, { style: styles.colQuantity }, toText(item.cantidad)),
              React.createElement(Text, { style: styles.colPrice }, formatCurrency(item.precioUnitario)),
              React.createElement(Text, { style: styles.colSubtotal }, formatCurrency(item.subtotal))
            )
          )
        )
      ),

      // Total
      React.createElement(View, { style: styles.totalsSection },
        React.createElement(View, { style: [styles.totalRow, styles.grandTotal] },
          React.createElement(Text, { style: styles.grandTotalLabel }, "TOTAL:"),
          React.createElement(Text, { style: styles.grandTotalValue }, formatCurrency(data.total))
        )
      ),

      // Validity
      fechaVencimiento
        ? React.createElement(View, { style: styles.validity },
            React.createElement(Text, { style: styles.validityText },
              `Esta cotizacion es valida hasta el ${fechaVencimiento}`
            )
          )
        : null,

      // Notes
      notas
        ? React.createElement(View, { style: styles.notes },
            React.createElement(Text, { style: styles.notesTitle }, "Notas:"),
            React.createElement(Text, { style: styles.notesText }, notas)
          )
        : null,

      // Signature Section (if approved)
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
                fechaAprobacion && React.createElement(Text, { style: styles.signatureDate },
                  `Aprobado: ${fechaAprobacion}`
                )
              )
            )
          )
        : null,

      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, null,
          firmaAprobacion
            ? "Cotizacion aprobada por el cliente."
            : "Gracias por su confianza. Para aceptar esta cotizacion, por favor contactenos."
        )
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
  passwordDispositivo?: string | null
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
  const passwordDispositivo = toText(data.passwordDispositivo)
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
      passwordDispositivo ? React.createElement(
        View,
        { style: ordenStyles.section },
        React.createElement(Text, { style: ordenStyles.sectionTitle }, "CONTRASENA/PIN"),
        React.createElement(
          View,
          { style: { backgroundColor: "#f3f4f6", padding: 8, borderRadius: 4 } },
          React.createElement(Text, { style: { fontSize: 12, fontFamily: "Courier" } }, passwordDispositivo)
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
    CONSOLA: "Consola", SMARTWATCH: "Smartwatch"
  }
  const tipoDispositivo = tipoLabels[data.tipoDispositivo] || safe(data.tipoDispositivo)
  const dispositivo = safe(data.dispositivo) || "Sin especificar"
  const marca = safe(data.marca)
  const colorDisp = safe(data.color)
  const imei = safe(data.imei)
  const problemaReportado = safe(data.problemaReportado) || "Sin descripcion"
  const accesorios = safe(data.accesorios)
  const passwordDispositivo = safe(data.passwordDispositivo)
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

  // Colores
  const primaryColor = rgb(0.231, 0.510, 0.965) // #3b82f6
  const primaryLight = rgb(0.239, 0.541, 0.969) // Lighter blue
  const textColor = rgb(0.122, 0.161, 0.216) // #1f2937
  const grayColor = rgb(0.420, 0.451, 0.502) // #6b7280
  const lightGray = rgb(0.898, 0.906, 0.922) // #e5e7eb
  const bgGray = rgb(0.953, 0.957, 0.965) // #f3f4f6
  const yellowBg = rgb(0.996, 0.953, 0.780) // #fef3c7
  const brownColor = rgb(0.573, 0.251, 0.055) // #92400e
  const greenColor = rgb(0.134, 0.545, 0.373) // #22c55e
  const white = rgb(1, 1, 1)

  // Margenes
  const margin = 35
  const contentWidth = width - (margin * 2)

  // === MARCO EXTERIOR ===
  page.drawRectangle({
    x: margin - 5,
    y: margin - 5,
    width: contentWidth + 10,
    height: height - (margin * 2) + 10,
    borderColor: primaryColor,
    borderWidth: 2,
  })

  // === HEADER BACKGROUND ===
  page.drawRectangle({
    x: margin,
    y: height - margin - 80,
    width: contentWidth,
    height: 80,
    color: rgb(0.976, 0.980, 0.988), // Very light blue
  })

  let y = height - margin - 20

  // === HEADER - Nombre empresa ===
  page.drawText(empresaNombre, { x: margin + 10, y, size: 20, font: helveticaBold, color: textColor })
  y -= 16

  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + 10, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + 10, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }

  // === HEADER - Numero de orden (lado derecho) ===
  const ordenText = `ORDEN #${numeroOrden}`
  const ordenWidth = helveticaBold.widthOfTextAtSize(ordenText, 18)

  // Badge para numero de orden
  page.drawRectangle({
    x: width - margin - ordenWidth - 30,
    y: height - margin - 45,
    width: ordenWidth + 20,
    height: 30,
    color: primaryColor,
  })
  page.drawText(ordenText, {
    x: width - margin - ordenWidth - 20,
    y: height - margin - 37,
    size: 18,
    font: helveticaBold,
    color: white
  })

  // Fechas
  page.drawText(`Ingreso: ${fechaIngreso}`, {
    x: width - margin - 100,
    y: height - margin - 58,
    size: 9,
    font: helvetica,
    color: grayColor
  })
  if (fechaPrometida) {
    page.drawText(`Entrega: ${fechaPrometida}`, {
      x: width - margin - 100,
      y: height - margin - 70,
      size: 9,
      font: helvetica,
      color: grayColor
    })
  }

  // === TITULO PRINCIPAL ===
  y = height - margin - 105
  const titleText = "COMPROBANTE DE RECEPCION"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 16)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 16, font: helveticaBold, color: primaryColor })

  // Linea decorativa debajo del titulo
  y -= 8
  page.drawLine({ start: { x: margin + 100, y }, end: { x: width - margin - 100, y }, thickness: 2, color: primaryColor })

  y -= 25

  // === DATOS DEL CLIENTE - Layout en 2 columnas ===
  page.drawRectangle({ x: margin, y: y - 75, width: contentWidth, height: 80, color: bgGray })

  page.drawText("DATOS DEL CLIENTE", { x: margin + 10, y: y - 3, size: 10, font: helveticaBold, color: primaryColor })
  y -= 18

  // Columna izquierda
  page.drawText("Nombre:", { x: margin + 10, y, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(clienteNombre, { x: margin + 70, y, size: 9, font: helvetica, color: textColor })
  y -= 14
  page.drawText("Telefono:", { x: margin + 10, y, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(clienteTelefono, { x: margin + 70, y, size: 9, font: helvetica, color: textColor })

  // Columna derecha
  if (clienteEmail) {
    page.drawText("Email:", { x: margin + 270, y: y + 14, size: 9, font: helveticaBold, color: grayColor })
    page.drawText(clienteEmail, { x: margin + 310, y: y + 14, size: 9, font: helvetica, color: textColor })
  }
  if (clienteDireccion) {
    page.drawText("Direccion:", { x: margin + 270, y, size: 9, font: helveticaBold, color: grayColor })
    page.drawText(clienteDireccion.substring(0, 35), { x: margin + 330, y, size: 9, font: helvetica, color: textColor })
  }

  y -= 50

  // === DATOS DEL DISPOSITIVO ===
  page.drawText("DATOS DEL DISPOSITIVO", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 3
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 15

  // Grid de datos del dispositivo
  const col1 = margin
  const col2 = margin + 180
  const col3 = margin + 360

  page.drawText("Tipo:", { x: col1, y, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(tipoDispositivo, { x: col1 + 50, y, size: 9, font: helvetica, color: textColor })

  page.drawText("Dispositivo:", { x: col2, y, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(dispositivo.substring(0, 20), { x: col2 + 65, y, size: 9, font: helvetica, color: textColor })

  if (marca) {
    page.drawText("Marca:", { x: col3, y, size: 9, font: helveticaBold, color: grayColor })
    page.drawText(marca, { x: col3 + 45, y, size: 9, font: helvetica, color: textColor })
  }

  y -= 14
  if (colorDisp) {
    page.drawText("Color:", { x: col1, y, size: 9, font: helveticaBold, color: grayColor })
    page.drawText(colorDisp, { x: col1 + 50, y, size: 9, font: helvetica, color: textColor })
  }
  if (imei) {
    page.drawText("IMEI/Serie:", { x: col2, y, size: 9, font: helveticaBold, color: grayColor })
    page.drawText(imei, { x: col2 + 65, y, size: 9, font: helvetica, color: textColor })
  }

  y -= 25

  // === PROBLEMA REPORTADO ===
  page.drawText("PROBLEMA REPORTADO", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 3
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 8

  // Caja con borde para problema
  const problemaHeight = problemaReportado.length > 80 ? 50 : 35
  page.drawRectangle({
    x: margin,
    y: y - problemaHeight,
    width: contentWidth,
    height: problemaHeight,
    color: bgGray,
    borderColor: lightGray,
    borderWidth: 1,
  })
  page.drawText(problemaReportado.substring(0, 90), { x: margin + 10, y: y - 15, size: 10, font: helvetica, color: textColor })
  if (problemaReportado.length > 90) {
    page.drawText(problemaReportado.substring(90, 180), { x: margin + 10, y: y - 28, size: 10, font: helvetica, color: textColor })
  }
  y -= problemaHeight + 15

  // === ACCESORIOS (si hay) ===
  if (accesorios) {
    page.drawRectangle({
      x: margin,
      y: y - 35,
      width: contentWidth,
      height: 40,
      color: yellowBg,
      borderColor: rgb(0.855, 0.647, 0.125),
      borderWidth: 1,
    })
    page.drawText("ACCESORIOS ENTREGADOS:", { x: margin + 10, y: y - 5, size: 9, font: helveticaBold, color: brownColor })
    page.drawText(accesorios.substring(0, 80), { x: margin + 10, y: y - 20, size: 9, font: helvetica, color: brownColor })
    y -= 50
  }

  // === CONTRASENA/PIN (si hay) ===
  if (passwordDispositivo) {
    page.drawText("CONTRASENA / PIN / PATRON", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
    y -= 18
    page.drawRectangle({
      x: margin,
      y: y - 8,
      width: 200,
      height: 25,
      color: bgGray,
      borderColor: lightGray,
      borderWidth: 1,
    })
    page.drawText(passwordDispositivo, { x: margin + 10, y: y, size: 14, font: courier, color: textColor })
    y -= 30
  }

  // === PRESUPUESTO (si hay) ===
  if (presupuesto) {
    page.drawRectangle({
      x: margin,
      y: y - 45,
      width: contentWidth,
      height: 50,
      color: rgb(0.941, 0.973, 0.953), // Light green bg
      borderColor: greenColor,
      borderWidth: 1,
    })
    page.drawText("PRESUPUESTO ESTIMADO", { x: margin + 10, y: y - 8, size: 10, font: helveticaBold, color: greenColor })
    page.drawText(presupuesto, { x: margin + 10, y: y - 28, size: 18, font: helveticaBold, color: greenColor })
    page.drawText("* El presupuesto final puede variar segun el diagnostico", { x: margin + 180, y: y - 38, size: 7, font: helvetica, color: grayColor })
    y -= 60
  }

  // === OBSERVACIONES (si hay) ===
  if (observaciones) {
    page.drawText("OBSERVACIONES", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
    y -= 3
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
    y -= 15
    page.drawText(observaciones.substring(0, 100), { x: margin, y, size: 9, font: helvetica, color: textColor })
    y -= 20
  }

  // === SECCION DE FIRMAS (posicion dinamica basada en contenido) ===
  // Asegurar espacio minimo para firmas (70px) y footer (90px)
  const minFooterSpace = 90
  const firmaHeight = 60
  const sigY = Math.max(y - 30, minFooterSpace + firmaHeight + 20)

  // Linea separadora antes de firmas
  page.drawLine({ start: { x: margin, y: sigY + 40 }, end: { x: width - margin, y: sigY + 40 }, thickness: 1, color: lightGray })

  // Firma Cliente
  page.drawLine({ start: { x: margin + 30, y: sigY + 10 }, end: { x: margin + 180, y: sigY + 10 }, thickness: 1, color: textColor })
  page.drawText("Firma del Cliente", { x: margin + 70, y: sigY - 2, size: 9, font: helvetica, color: grayColor })
  page.drawText("Aclaracion: ________________", { x: margin + 40, y: sigY - 14, size: 8, font: helvetica, color: grayColor })
  page.drawText("DNI: ________________", { x: margin + 55, y: sigY - 26, size: 8, font: helvetica, color: grayColor })

  // Firma Tecnico
  page.drawLine({ start: { x: width - margin - 180, y: sigY + 10 }, end: { x: width - margin - 30, y: sigY + 10 }, thickness: 1, color: textColor })
  page.drawText("Firma del Tecnico", { x: width - margin - 145, y: sigY - 2, size: 9, font: helvetica, color: grayColor })
  page.drawText("Aclaracion: ________________", { x: width - margin - 165, y: sigY - 14, size: 8, font: helvetica, color: grayColor })

  // === FOOTER (compacto) ===
  const footerY = minFooterSpace

  // Fondo del footer
  page.drawRectangle({
    x: margin,
    y: margin,
    width: contentWidth,
    height: footerY - margin,
    color: bgGray,
  })

  // Terminos y condiciones (mas compactos)
  page.drawText("TERMINOS Y CONDICIONES", { x: margin + 10, y: footerY - 10, size: 7, font: helveticaBold, color: grayColor })

  const terminos = [
    "1. Conserve este comprobante para retirar su equipo. El plazo de retiro es de 30 dias.",
    "2. No nos hacemos responsables por datos perdidos. Realice backup antes de entregar el equipo.",
    "3. Al firmar, el cliente acepta haber revisado el estado del equipo al momento de la entrega.",
  ]

  let termY = footerY - 22
  terminos.forEach(t => {
    page.drawText(t, { x: margin + 10, y: termY, size: 6, font: helvetica, color: grayColor })
    termY -= 9
  })

  // Linea final
  page.drawLine({ start: { x: margin, y: margin + 3 }, end: { x: width - margin, y: margin + 3 }, thickness: 2, color: primaryColor })

  // Fecha de impresion y numero de orden en la misma linea
  const impresionText = `Impreso: ${fechaImpresion}`
  const impresionWidth = helvetica.widthOfTextAtSize(impresionText, 6)
  page.drawText(impresionText, { x: width - margin - impresionWidth, y: margin + 8, size: 6, font: helvetica, color: grayColor })
  page.drawText(`Orden #${numeroOrden}`, { x: margin + 10, y: margin + 8, size: 6, font: helveticaBold, color: grayColor })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

export type { CotizacionPDFData, CotizacionItem, OrdenPDFData }
