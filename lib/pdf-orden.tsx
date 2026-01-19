import React from "react"
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
  Svg,
  Path,
  Circle,
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
  passwordDispositivo?: string | null
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
const formatDate = (date: Date): string => {
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)
}

const tipoDispositivoLabels: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  OTRO: "Otro",
}

// Detectar si es patrón o PIN
const isPatternLock = (value: string): boolean => {
  return value.startsWith("Patrón: ")
}

// Parsear el patrón
const parsePattern = (value: string): number[] => {
  if (!value || !value.startsWith("Patrón: ")) return []
  const patternStr = value.replace("Patrón: ", "")
  return patternStr
    .split("-")
    .map(Number)
    .filter((n) => n >= 1 && n <= 9)
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
  // Header
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
    borderRadius: 10,
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
    color: "#1e1b4b",
  },
  orderNumberSpan: {
    color: "#6366f1",
  },
  orderDates: {
    marginTop: 4,
  },
  orderDateText: {
    fontSize: 10,
    color: "#64748b",
  },
  orderDateLabel: {
    fontWeight: "bold",
    color: "#1e293b",
  },
  // Título principal
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
  titleDecoration: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  titleLine: {
    width: 30,
    height: 2,
    backgroundColor: "#6366f1",
  },
  // Grid 2 columnas
  grid2: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  gridCol: {
    flex: 1,
  },
  // Cards
  card: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardTitle: {
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
    fontWeight: "medium",
  },
  // Info boxes
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
  // Sections
  section: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionTitle: {
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
  // Firmas
  signatures: {
    flexDirection: "row",
    gap: 30,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 2,
    borderTopColor: "#e2e8f0",
    borderTopStyle: "dashed",
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
    fontWeight: "medium",
  },
  // Footer
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
  // Bottom bar
  bottomBar: {
    height: 6,
    backgroundColor: "#6366f1",
    marginTop: 14,
    borderRadius: 3,
  },
  // Pattern
  patternContainer: {
    marginTop: 4,
    alignItems: "center",
  },
})

// ========================================
// COMPONENTE DE PATRÓN SVG
// ========================================
const PatternLockSVG = ({ patternValue }: { patternValue: string }) => {
  const pattern = parsePattern(patternValue)
  if (pattern.length === 0) return null

  const size = 60
  const padding = 10
  const spacing = (size - 2 * padding) / 2

  // Calcular posición de cada punto (1-9)
  const getPos = (num: number) => {
    const index = num - 1
    const row = Math.floor(index / 3)
    const col = index % 3
    return {
      x: padding + col * spacing,
      y: padding + row * spacing,
    }
  }

  // Generar el path
  let pathD = ""
  if (pattern.length > 0) {
    const first = getPos(pattern[0])
    pathD = `M ${first.x} ${first.y}`
    for (let i = 1; i < pattern.length; i++) {
      const pos = getPos(pattern[i])
      pathD += ` L ${pos.x} ${pos.y}`
    }
  }

  return (
    <Svg viewBox={`0 0 ${size} ${size}`} style={{ width: 60, height: 60 }}>
      {/* Background */}
      <Path
        d={`M 4 0 L ${size - 4} 0 Q ${size} 0 ${size} 4 L ${size} ${size - 4} Q ${size} ${size} ${size - 4} ${size} L 4 ${size} Q 0 ${size} 0 ${size - 4} L 0 4 Q 0 0 4 0`}
        fill="#f8fafc"
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      {/* Pattern line */}
      {pathD && (
        <Path
          d={pathD}
          stroke="#6366f1"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Dots */}
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
        const pos = getPos(i)
        const isSelected = pattern.includes(i)
        return (
          <React.Fragment key={i}>
            <Circle
              cx={pos.x}
              cy={pos.y}
              r={5}
              fill={isSelected ? "#6366f1" : "#e2e8f0"}
            />
            <Circle
              cx={pos.x}
              cy={pos.y}
              r={2}
              fill={isSelected ? "#4f46e5" : "#9ca3af"}
            />
          </React.Fragment>
        )
      })}
    </Svg>
  )
}

// ========================================
// COMPONENTE DEL DOCUMENTO
// ========================================
const OrdenPDFDocument = ({ data }: { data: OrdenPDFData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      {/* Barra de acento superior */}
      <View style={styles.accentBar} />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {data.logoUrl ? (
              <Image src={data.logoUrl} style={styles.logo} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Svg viewBox="0 0 24 24" style={{ width: 26, height: 26 }}>
                  <Path
                    d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5m-4 0h4"
                    stroke="#ffffff"
                    strokeWidth={2}
                    fill="none"
                  />
                </Svg>
              </View>
            )}
            <View style={styles.companyInfo}>
              <Text style={styles.companyName}>
                {data.nombreEmpresa || "Servicio Técnico"}
              </Text>
              {data.telefonoEmpresa && (
                <Text style={styles.companyDetail}>{data.telefonoEmpresa}</Text>
              )}
              {data.direccionEmpresa && (
                <Text style={styles.companyDetail}>{data.direccionEmpresa}</Text>
              )}
            </View>
          </View>

          <View style={styles.headerRight}>
            <View style={styles.docBadge}>
              <Text style={styles.docBadgeText}>RECEPCIÓN</Text>
            </View>
            <Text style={styles.orderNumber}>
              #<Text style={styles.orderNumberSpan}>{data.numeroOrden}</Text>
            </Text>
            <View style={styles.orderDates}>
              <Text style={styles.orderDateText}>
                <Text style={styles.orderDateLabel}>Ingreso: </Text>
                {formatDate(data.fechaIngreso)}
              </Text>
              {data.fechaPrometida && (
                <Text style={styles.orderDateText}>
                  <Text style={styles.orderDateLabel}>Entrega: </Text>
                  {formatDate(data.fechaPrometida)}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Título */}
        <View style={styles.mainTitle}>
          <Text style={styles.mainTitleText}>COMPROBANTE DE RECEPCIÓN</Text>
          <View style={styles.titleDecoration}>
            <View style={styles.titleLine} />
          </View>
        </View>

        {/* Grid Cliente y Dispositivo */}
        <View style={styles.grid2}>
          {/* Datos del Cliente */}
          <View style={styles.gridCol}>
            <View style={styles.card}>
              <View style={styles.cardTitle}>
                <View style={styles.cardTitleBar} />
                <Text style={styles.cardTitleText}>DATOS DEL CLIENTE</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Nombre</Text>
                <Text style={styles.cardValue}>{data.cliente.nombre}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Teléfono</Text>
                <Text style={styles.cardValue}>{data.cliente.telefono}</Text>
              </View>
              {data.cliente.email && (
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Email</Text>
                  <Text style={styles.cardValue}>{data.cliente.email}</Text>
                </View>
              )}
              {data.cliente.direccion && (
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Dirección</Text>
                  <Text style={styles.cardValue}>{data.cliente.direccion}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Datos del Dispositivo */}
          <View style={styles.gridCol}>
            <View style={styles.card}>
              <View style={styles.cardTitle}>
                <View style={styles.cardTitleBar} />
                <Text style={styles.cardTitleText}>DISPOSITIVO</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Tipo</Text>
                <Text style={styles.cardValue}>
                  {tipoDispositivoLabels[data.tipoDispositivo] ||
                    data.tipoDispositivo}
                </Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Equipo</Text>
                <Text style={styles.cardValue}>{data.dispositivo}</Text>
              </View>
              {data.marca && (
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Marca</Text>
                  <Text style={styles.cardValue}>{data.marca}</Text>
                </View>
              )}
              {data.color && (
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Color</Text>
                  <Text style={styles.cardValue}>{data.color}</Text>
                </View>
              )}
              {data.imei && (
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>IMEI/Serie</Text>
                  <Text style={styles.cardValue}>{data.imei}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Info boxes */}
        {(data.accesorios || data.passwordDispositivo || data.presupuesto) && (
          <View style={styles.infoBoxes}>
            {data.accesorios && (
              <View style={styles.infoBox}>
                <Text style={styles.infoBoxLabel}>ACCESORIOS</Text>
                <Text style={styles.infoBoxValue}>{data.accesorios}</Text>
              </View>
            )}
            {data.passwordDispositivo && (
              <View style={styles.infoBox}>
                <Text style={styles.infoBoxLabel}>
                  {isPatternLock(data.passwordDispositivo)
                    ? "PATRÓN"
                    : "PIN/CONTRASEÑA"}
                </Text>
                {isPatternLock(data.passwordDispositivo) ? (
                  <View style={styles.patternContainer}>
                    <PatternLockSVG patternValue={data.passwordDispositivo} />
                  </View>
                ) : (
                  <Text style={styles.infoBoxValue}>
                    {data.passwordDispositivo}
                  </Text>
                )}
              </View>
            )}
            {data.presupuesto && (
              <View style={styles.infoBoxHighlight}>
                <Text style={styles.infoBoxLabel}>PRESUPUESTO ESTIMADO</Text>
                <Text style={styles.infoBoxValueHighlight}>
                  {formatCurrency(data.presupuesto)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Problema Reportado */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <View style={styles.sectionTitleBar} />
            <Text style={styles.sectionTitleText}>PROBLEMA REPORTADO</Text>
          </View>
          <Text style={styles.sectionContent}>{data.problemaReportado}</Text>
        </View>

        {/* Observaciones */}
        {data.observaciones && (
          <View style={styles.section}>
            <View style={styles.sectionTitle}>
              <View style={styles.sectionTitleBar} />
              <Text style={styles.sectionTitleText}>OBSERVACIONES</Text>
            </View>
            <Text style={styles.sectionContent}>{data.observaciones}</Text>
          </View>
        )}

        {/* Firmas */}
        <View style={styles.signatures}>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Firma del Cliente</Text>
          </View>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Firma del Técnico</Text>
          </View>
        </View>

        {/* Footer - Términos */}
        <View style={styles.footer}>
          <Text style={styles.footerTitle}>TÉRMINOS Y CONDICIONES</Text>
          <View style={styles.footerItem}>
            <Text style={styles.footerBullet}>•</Text>
            <Text style={styles.footerText}>
              El plazo de reparación está sujeto a disponibilidad de repuestos.
            </Text>
          </View>
          <View style={styles.footerItem}>
            <Text style={styles.footerBullet}>•</Text>
            <Text style={styles.footerText}>
              Los equipos no retirados en 90 días serán considerados en abandono.
            </Text>
          </View>
          <View style={styles.footerItem}>
            <Text style={styles.footerBullet}>•</Text>
            <Text style={styles.footerText}>
              No nos hacemos responsables por datos almacenados en el dispositivo.
            </Text>
          </View>
          <View style={styles.footerItem}>
            <Text style={styles.footerBullet}>•</Text>
            <Text style={styles.footerText}>
              El presupuesto puede variar según el diagnóstico técnico.
            </Text>
          </View>
        </View>

        {/* Bottom bar */}
        <View style={styles.bottomBar} />
      </View>
    </Page>
  </Document>
)

// ========================================
// FUNCIÓN EXPORTADA PARA GENERAR PDF
// ========================================
export async function generateOrdenPDF(data: OrdenPDFData): Promise<Buffer> {
  const buffer = await renderToBuffer(<OrdenPDFDocument data={data} />)
  return Buffer.from(buffer)
}
