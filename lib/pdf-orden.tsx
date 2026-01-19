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

// ========================================
// TIPOS
// ========================================
export interface OrdenPDFData {
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

// ========================================
// HELPERS
// ========================================
const formatDate = (date: Date | string | number | null | undefined): string => {
  if (!date) return ""
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ""
  return parsed.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

const formatCurrency = (amount: number | string | null | undefined): string => {
  if (amount === null || amount === undefined) return ""
  const numericAmount = typeof amount === "string" ? Number(amount) : amount
  if (Number.isNaN(numericAmount)) return ""
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(numericAmount)
}

const tipoDispositivoLabels: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  OTRO: "Otro",
}

// Ensure we never pass objects/React nodes into <Text>
const toText = (val: unknown): string => {
  if (val === null || val === undefined || val === false) return ""
  if (React.isValidElement(val)) return ""
  if (Array.isArray(val)) {
    return val.map((v) => toText(v)).join(", ")
  }
  if (typeof val === "object") {
    if (val instanceof Date) {
      return formatDate(val)
    }
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

// Detectar si es patron
const isPatternLock = (value: string): boolean => {
  return value.startsWith("Patron: ") || value.startsWith("Patrón: ")
}

const formatPatternDisplay = (value: string): string => {
  if (!value) return value
  return value.replace("Patron: ", "").replace("Patrón: ", "")
}

// ========================================
// ESTILOS
// ========================================
const styles = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: 10,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  accentBar: {
    height: 6,
    backgroundColor: "#6366f1",
  },
  container: {
    padding: 28,
    paddingTop: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#f1f5f9",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  logo: {
    width: 50,
    height: 50,
    marginRight: 12,
  },
  logoPlaceholder: {
    width: 50,
    height: 50,
    marginRight: 12,
    backgroundColor: "#6366f1",
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  logoPlaceholderText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
  },
  companyInfo: {
    justifyContent: "center",
  },
  companyName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1e1b4b",
    marginBottom: 2,
  },
  companyDetail: {
    fontSize: 10,
    color: "#64748b",
    marginBottom: 1,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  docBadge: {
    backgroundColor: "#6366f1",
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginBottom: 6,
  },
  docBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "bold",
  },
  orderNumber: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#6366f1",
  },
  orderDates: {
    marginTop: 4,
  },
  orderDateText: {
    fontSize: 10,
    color: "#64748b",
  },
  mainTitle: {
    alignItems: "center",
    marginBottom: 14,
  },
  mainTitleText: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1e1b4b",
    letterSpacing: 2,
  },
  titleLine: {
    width: 30,
    height: 2,
    backgroundColor: "#6366f1",
    marginTop: 4,
  },
  grid2: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  gridCol: {
    flex: 1,
  },
  card: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitleBar: {
    width: 3,
    height: 12,
    backgroundColor: "#6366f1",
    borderRadius: 2,
    marginRight: 6,
  },
  cardTitleText: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#6366f1",
    letterSpacing: 1,
  },
  cardRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  cardLabel: {
    width: 70,
    fontSize: 10,
    color: "#64748b",
  },
  cardValue: {
    flex: 1,
    fontSize: 11,
    color: "#1e293b",
  },
  infoBoxes: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  infoBox: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  infoBoxHighlight: {
    flex: 1,
    backgroundColor: "#f5f3ff",
    borderWidth: 2,
    borderColor: "#6366f1",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  infoBoxLabel: {
    fontSize: 8,
    color: "#64748b",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoBoxValue: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#1e293b",
  },
  infoBoxValueHighlight: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#6366f1",
  },
  patternValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#6366f1",
    letterSpacing: 2,
  },
  section: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  sectionTitleBar: {
    width: 3,
    height: 12,
    backgroundColor: "#6366f1",
    borderRadius: 2,
    marginRight: 6,
  },
  sectionTitleText: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#6366f1",
    letterSpacing: 1,
  },
  sectionContent: {
    fontSize: 11,
    color: "#374151",
    lineHeight: 1.5,
  },
  signatures: {
    flexDirection: "row",
    gap: 30,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 2,
    borderTopColor: "#e2e8f0",
  },
  signatureBox: {
    flex: 1,
    alignItems: "center",
  },
  signatureLine: {
    width: "100%",
    borderTopWidth: 2,
    borderTopColor: "#1e293b",
    marginTop: 30,
    marginBottom: 6,
  },
  signatureLabel: {
    fontSize: 10,
    color: "#64748b",
  },
  footer: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  footerTitle: {
    fontSize: 8,
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 6,
    color: "#6366f1",
  },
  footerItem: {
    flexDirection: "row",
    marginBottom: 2,
  },
  footerBullet: {
    fontSize: 8,
    color: "#6366f1",
    marginRight: 4,
  },
  footerText: {
    fontSize: 8,
    color: "#64748b",
    flex: 1,
  },
  bottomBar: {
    height: 6,
    backgroundColor: "#6366f1",
    marginTop: 14,
    borderRadius: 3,
  },
})

// ========================================
// COMPONENTE DEL DOCUMENTO (usando React.createElement)
// ========================================
const OrdenPDFDocument = ({ data }: { data: OrdenPDFData }) => {
  // Pre-compute all strings
  const companyName = toText(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = toText(data.telefonoEmpresa)
  const direccionEmpresa = toText(data.direccionEmpresa)
  const logoUrl = toText(data.logoUrl)
  const orderNum = toText(data.numeroOrden)
  const fechaIngresoStr = formatDate(data.fechaIngreso)
  const fechaPrometidaStr = formatDate(data.fechaPrometida)
  const clienteNombre = toText(data.cliente.nombre)
  const clienteTelefono = toText(data.cliente.telefono)
  const clienteEmail = toText(data.cliente.email)
  const clienteDireccion = toText(data.cliente.direccion)
  const tipoDispositivoStr = tipoDispositivoLabels[data.tipoDispositivo] || toText(data.tipoDispositivo)
  const dispositivo = toText(data.dispositivo)
  const marca = toText(data.marca)
  const color = toText(data.color)
  const imei = toText(data.imei)
  const accesorios = toText(data.accesorios)
  const passwordRaw = toText(data.codigoAccesoDispositivo)
  const isPattern = passwordRaw ? isPatternLock(passwordRaw) : false
  const passwordDisplay = isPattern ? formatPatternDisplay(passwordRaw) : passwordRaw
  const presupuestoStr = formatCurrency(data.presupuesto)
  const problemaReportado = toText(data.problemaReportado)
  const observaciones = toText(data.observaciones)

  const hasInfoBoxes = accesorios || passwordDisplay || presupuestoStr

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      // Accent bar
      React.createElement(View, { style: styles.accentBar }),
      // Container
      React.createElement(
        View,
        { style: styles.container },
        // Header
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(
            View,
            { style: styles.headerLeft },
            logoUrl
              ? React.createElement(Image, { src: logoUrl, style: styles.logo })
              : React.createElement(
                  View,
                  { style: styles.logoPlaceholder },
                  React.createElement(Text, { style: styles.logoPlaceholderText }, "ST")
                ),
            React.createElement(
              View,
              { style: styles.companyInfo },
              React.createElement(Text, { style: styles.companyName }, companyName),
              telefonoEmpresa
                ? React.createElement(Text, { style: styles.companyDetail }, telefonoEmpresa)
                : null,
              direccionEmpresa
                ? React.createElement(Text, { style: styles.companyDetail }, direccionEmpresa)
                : null
            )
          ),
          React.createElement(
            View,
            { style: styles.headerRight },
            React.createElement(
              View,
              { style: styles.docBadge },
              React.createElement(Text, { style: styles.docBadgeText }, "RECEPCION")
            ),
            React.createElement(Text, { style: styles.orderNumber }, `#${orderNum}`),
            React.createElement(
              View,
              { style: styles.orderDates },
              React.createElement(Text, { style: styles.orderDateText }, `Ingreso: ${fechaIngresoStr}`),
              fechaPrometidaStr
                ? React.createElement(Text, { style: styles.orderDateText }, `Entrega: ${fechaPrometidaStr}`)
                : null
            )
          )
        ),
        // Main title
        React.createElement(
          View,
          { style: styles.mainTitle },
          React.createElement(Text, { style: styles.mainTitleText }, "COMPROBANTE DE RECEPCION"),
          React.createElement(View, { style: styles.titleLine })
        ),
        // Grid: Cliente y Dispositivo
        React.createElement(
          View,
          { style: styles.grid2 },
          // Cliente Card
          React.createElement(
            View,
            { style: styles.gridCol },
            React.createElement(
              View,
              { style: styles.card },
              React.createElement(
                View,
                { style: styles.cardTitleRow },
                React.createElement(View, { style: styles.cardTitleBar }),
                React.createElement(Text, { style: styles.cardTitleText }, "DATOS DEL CLIENTE")
              ),
              React.createElement(
                View,
                { style: styles.cardRow },
                React.createElement(Text, { style: styles.cardLabel }, "Nombre"),
                React.createElement(Text, { style: styles.cardValue }, clienteNombre)
              ),
              React.createElement(
                View,
                { style: styles.cardRow },
                React.createElement(Text, { style: styles.cardLabel }, "Telefono"),
                React.createElement(Text, { style: styles.cardValue }, clienteTelefono)
              ),
              clienteEmail
                ? React.createElement(
                    View,
                    { style: styles.cardRow },
                    React.createElement(Text, { style: styles.cardLabel }, "Email"),
                    React.createElement(Text, { style: styles.cardValue }, clienteEmail)
                  )
                : null,
              clienteDireccion
                ? React.createElement(
                    View,
                    { style: styles.cardRow },
                    React.createElement(Text, { style: styles.cardLabel }, "Direccion"),
                    React.createElement(Text, { style: styles.cardValue }, clienteDireccion)
                  )
                : null
            )
          ),
          // Dispositivo Card
          React.createElement(
            View,
            { style: styles.gridCol },
            React.createElement(
              View,
              { style: styles.card },
              React.createElement(
                View,
                { style: styles.cardTitleRow },
                React.createElement(View, { style: styles.cardTitleBar }),
                React.createElement(Text, { style: styles.cardTitleText }, "DISPOSITIVO")
              ),
              React.createElement(
                View,
                { style: styles.cardRow },
                React.createElement(Text, { style: styles.cardLabel }, "Tipo"),
                React.createElement(Text, { style: styles.cardValue }, tipoDispositivoStr)
              ),
              React.createElement(
                View,
                { style: styles.cardRow },
                React.createElement(Text, { style: styles.cardLabel }, "Equipo"),
                React.createElement(Text, { style: styles.cardValue }, dispositivo)
              ),
              marca
                ? React.createElement(
                    View,
                    { style: styles.cardRow },
                    React.createElement(Text, { style: styles.cardLabel }, "Marca"),
                    React.createElement(Text, { style: styles.cardValue }, marca)
                  )
                : null,
              color
                ? React.createElement(
                    View,
                    { style: styles.cardRow },
                    React.createElement(Text, { style: styles.cardLabel }, "Color"),
                    React.createElement(Text, { style: styles.cardValue }, color)
                  )
                : null,
              imei
                ? React.createElement(
                    View,
                    { style: styles.cardRow },
                    React.createElement(Text, { style: styles.cardLabel }, "IMEI/Serie"),
                    React.createElement(Text, { style: styles.cardValue }, imei)
                  )
                : null
            )
          )
        ),
        // Info boxes
        hasInfoBoxes
          ? React.createElement(
              View,
              { style: styles.infoBoxes },
              accesorios
                ? React.createElement(
                    View,
                    { style: styles.infoBox },
                    React.createElement(Text, { style: styles.infoBoxLabel }, "ACCESORIOS"),
                    React.createElement(Text, { style: styles.infoBoxValue }, accesorios)
                  )
                : null,
              passwordDisplay
                ? React.createElement(
                    View,
                    { style: styles.infoBox },
                    React.createElement(
                      Text,
                      { style: styles.infoBoxLabel },
                      isPattern ? "PATRON" : "PIN/CONTRASENA"
                    ),
                    React.createElement(
                      Text,
                      { style: isPattern ? styles.patternValue : styles.infoBoxValue },
                      passwordDisplay
                    )
                  )
                : null,
              presupuestoStr
                ? React.createElement(
                    View,
                    { style: styles.infoBoxHighlight },
                    React.createElement(Text, { style: styles.infoBoxLabel }, "PRESUPUESTO ESTIMADO"),
                    React.createElement(Text, { style: styles.infoBoxValueHighlight }, presupuestoStr)
                  )
                : null
            )
          : null,
        // Problema Reportado
        React.createElement(
          View,
          { style: styles.section },
          React.createElement(
            View,
            { style: styles.sectionTitleRow },
            React.createElement(View, { style: styles.sectionTitleBar }),
            React.createElement(Text, { style: styles.sectionTitleText }, "PROBLEMA REPORTADO")
          ),
          React.createElement(Text, { style: styles.sectionContent }, problemaReportado)
        ),
        // Observaciones
        observaciones
          ? React.createElement(
              View,
              { style: styles.section },
              React.createElement(
                View,
                { style: styles.sectionTitleRow },
                React.createElement(View, { style: styles.sectionTitleBar }),
                React.createElement(Text, { style: styles.sectionTitleText }, "OBSERVACIONES")
              ),
              React.createElement(Text, { style: styles.sectionContent }, observaciones)
            )
          : null,
        // Firmas
        React.createElement(
          View,
          { style: styles.signatures },
          React.createElement(
            View,
            { style: styles.signatureBox },
            React.createElement(View, { style: styles.signatureLine }),
            React.createElement(Text, { style: styles.signatureLabel }, "Firma del Cliente")
          ),
          React.createElement(
            View,
            { style: styles.signatureBox },
            React.createElement(View, { style: styles.signatureLine }),
            React.createElement(Text, { style: styles.signatureLabel }, "Firma del Tecnico")
          )
        ),
        // Footer
        React.createElement(
          View,
          { style: styles.footer },
          React.createElement(Text, { style: styles.footerTitle }, "TERMINOS Y CONDICIONES"),
          React.createElement(
            View,
            { style: styles.footerItem },
            React.createElement(Text, { style: styles.footerBullet }, "*"),
            React.createElement(
              Text,
              { style: styles.footerText },
              "El plazo de reparacion esta sujeto a disponibilidad de repuestos."
            )
          ),
          React.createElement(
            View,
            { style: styles.footerItem },
            React.createElement(Text, { style: styles.footerBullet }, "*"),
            React.createElement(
              Text,
              { style: styles.footerText },
              "Los equipos no retirados en 90 dias seran considerados en abandono."
            )
          ),
          React.createElement(
            View,
            { style: styles.footerItem },
            React.createElement(Text, { style: styles.footerBullet }, "*"),
            React.createElement(
              Text,
              { style: styles.footerText },
              "No nos hacemos responsables por datos almacenados en el dispositivo."
            )
          ),
          React.createElement(
            View,
            { style: styles.footerItem },
            React.createElement(Text, { style: styles.footerBullet }, "*"),
            React.createElement(
              Text,
              { style: styles.footerText },
              "El presupuesto puede variar segun el diagnostico tecnico."
            )
          )
        ),
        // Bottom bar
        React.createElement(View, { style: styles.bottomBar })
      )
    )
  )
}

// ========================================
// FUNCION EXPORTADA PARA GENERAR PDF
// ========================================
export async function generateOrdenPDF(data: OrdenPDFData): Promise<Buffer> {
  const buffer = await renderToBuffer(
    React.createElement(OrdenPDFDocument, { data }) as React.ReactElement
  )
  return Buffer.from(buffer)
}
