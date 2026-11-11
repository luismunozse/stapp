/**
 * Textos del aviso al cliente de una garantía por vencer (GARANTIA_POR_VENCER)
 * que comparten el email, el WhatsApp y el catálogo de plantillas. Sin
 * dependencias de servidor.
 */
import { textoVencimiento } from "./estado"

export interface GarantiaAvisoContexto {
  origen?: "REPARACION" | "VENTA"
  /** Producto (venta) o equipo (reparación). */
  descripcion?: string | null
  numeroGarantia?: string | null
  /** 0 = vence hoy. */
  diasRestantes?: number | null
}

/**
 * Qué cubre la garantía, dicho al cliente:
 *   "la reparación de tu iPhone 12 (orden #1234)"
 *   "tu Auriculares BT (certificado G-0001)"
 */
export function detalleGarantiaCliente(
  garantia: GarantiaAvisoContexto | null | undefined,
  orden?: { dispositivo?: string | null; numeroOrden?: number | null } | null
): string {
  if (garantia?.origen === "VENTA") {
    const producto = garantia.descripcion?.trim() || "compra"
    return `tu ${producto}${garantia.numeroGarantia ? ` (certificado ${garantia.numeroGarantia})` : ""}`
  }
  const equipo = orden?.dispositivo?.trim() || garantia?.descripcion?.trim() || "equipo"
  return `la reparación de tu ${equipo}${orden?.numeroOrden ? ` (orden #${orden.numeroOrden})` : ""}`
}

/** "vence hoy", "vence mañana", "vence en 5 días". */
export function venceTextoCliente(diasRestantes: number | null | undefined): string {
  if (diasRestantes == null || !Number.isFinite(diasRestantes)) return "está por vencer"
  return textoVencimiento(Math.max(0, Math.trunc(diasRestantes))).toLowerCase()
}
