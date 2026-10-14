/**
 * Catálogo de la nota de crédito: tipos y etiquetas que comparten el listado,
 * el PDF, el ticket y el mensaje de WhatsApp.
 *
 * Los códigos son los de la base: el CHECK de motivos de la migración 350 y
 * los medios de `notas_credito.metodo_devolucion` (186) y del enum
 * `metodo_reembolso` (053). Las etiquetas de motivo y de medio también las lee
 * el cliente final en el PDF y en el ticket: tienen que sonar a mostrador, no
 * a código.
 */

export type OrigenNC = "VENTA" | "ORDEN"
export type ModoNC = "ITEMS" | "MONTO"

export const MOTIVOS_NC = [
  "DEVOLUCION",
  "AJUSTE_PRECIO",
  "GARANTIA",
  "ERROR_FACTURACION",
  "DESCUENTO_RETRO",
  "TRABAJO_NO_REALIZADO",
  "OTRO",
] as const

export type MotivoNC = (typeof MOTIVOS_NC)[number]

export const MOTIVO_NC_LABELS: Record<MotivoNC, string> = {
  DEVOLUCION: "Devolución de productos",
  AJUSTE_PRECIO: "Ajuste de precio",
  GARANTIA: "Garantía",
  ERROR_FACTURACION: "Error de cobro",
  DESCUENTO_RETRO: "Descuento posterior a la compra",
  TRABAJO_NO_REALIZADO: "Trabajo no realizado",
  OTRO: "Otro",
}

export const MODO_NC_LABELS: Record<ModoNC, string> = {
  ITEMS: "Por productos",
  MONTO: "Por monto",
}

export const ORIGEN_NC_LABELS: Record<OrigenNC, string> = {
  VENTA: "Venta",
  ORDEN: "Orden",
}

export const CONSUMIDOR_FINAL = "Consumidor final"

// Incluye los medios históricos que la base sigue aceptando para no romper el
// historial (spec, "Catálogo compartido"). Un código que no esté acá se
// muestra como "Otro medio": nunca crudo en un documento para el cliente.
const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
  MERCADOPAGO: "Mercado Pago",
  NOTA_CREDITO_INTERNA: "Crédito en el local",
  CREDITO_TIENDA: "Crédito en el local",
  OTRO: "Otro medio",
}

export function esMotivoNC(v: unknown): v is MotivoNC {
  return typeof v === "string" && (MOTIVOS_NC as readonly string[]).includes(v)
}

/**
 * El motivo para mostrar: la etiqueta del catálogo o, en el historial (sin
 * motivo de catálogo), el texto libre que se cargó.
 */
export function etiquetaMotivo(
  motivoNc: string | null | undefined,
  detalle: string | null | undefined
): string {
  if (esMotivoNC(motivoNc)) return MOTIVO_NC_LABELS[motivoNc]
  const libre = (detalle ?? "").trim()
  return libre || "Sin motivo"
}

/** El medio de reintegro para mostrar; null cuando no hubo reintegro. */
export function etiquetaMetodo(metodo: string | null | undefined): string | null {
  if (!metodo) return null
  return METODO_LABELS[metodo] ?? "Otro medio"
}

/**
 * El renglón del reintegro en el PDF y el ticket. Lo que fue a la cuenta
 * corriente o quedó como crédito en el local no "se devolvió": quedó a favor
 * del cliente, y el documento lo tiene que decir así.
 */
export function etiquetaReintegro(metodo: string | null | undefined): string {
  if (metodo === "CUENTA_CORRIENTE") return "A tu favor en cuenta corriente"
  if (metodo === "CREDITO_TIENDA" || metodo === "NOTA_CREDITO_INTERNA") return "Crédito a tu favor en el local"
  const medio = etiquetaMetodo(metodo)
  // Sin medio (historial) no se sabe si el dinero salió: el renglón no lo afirma.
  return medio ? `Te devolvimos (${medio})` : "Reintegro"
}

/**
 * Número de la operación de origen como lo muestra el resto del sistema:
 * ventas "V0042"; órdenes con su código ("CEL099") o "#0007" si no tienen.
 * La vista lo trae como texto (`COALESCE(codigo_orden, numero_orden)`).
 */
export function numeroOperacion(origen: OrigenNC, origenNumero: string | null | undefined): string {
  const n = (origenNumero ?? "").trim()
  if (!n) return "—"
  if (!/^\d+$/.test(n)) return n
  return origen === "VENTA" ? `V${n.padStart(4, "0")}` : `#${n.padStart(4, "0")}`
}
