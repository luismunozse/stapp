/**
 * Mensaje de pedido para el plan sin `cotizaciones_online`.
 *
 * Esos catálogos no persisten nada: el carrito se arma en el cliente y se manda
 * por WhatsApp al taller. Es una función pura (sin imports de servidor) para
 * poder usarla desde el bundle del navegador; la moneda llega por `formatPrecio`.
 */

/** Tope de las notas: el texto viaja url-encoded en el link de wa.me. */
export const NOTAS_PEDIDO_MAX = 500

export interface PedidoWhatsAppItem {
  nombre: string
  varianteEtiqueta?: string | null
  cantidad: number
  precio: number
}

export interface PedidoWhatsAppInput {
  taller: string
  cliente?: string
  items: PedidoWhatsAppItem[]
  total: number
  notas?: string
  formatPrecio: (n: number) => string
}

export function construirMensajePedidoWhatsApp(input: PedidoWhatsAppInput): string {
  const { taller, cliente, items, total, notas, formatPrecio } = input
  const lineas = items.map((i) => {
    const nombre = i.varianteEtiqueta ? `${i.nombre} (${i.varianteEtiqueta})` : i.nombre
    return `• ${i.cantidad}× ${nombre} — ${formatPrecio(i.precio)} c/u = ${formatPrecio(i.precio * i.cantidad)}`
  })
  const partes = [`Hola${taller ? ` ${taller}` : ""}, quiero hacer este pedido:`]
  if (cliente?.trim()) partes.push(`Nombre: ${cliente.trim()}`)
  partes.push("", ...lineas, "", `Total: ${formatPrecio(total)}`)
  if (notas?.trim()) partes.push(`Notas: ${notas.trim().slice(0, NOTAS_PEDIDO_MAX)}`)
  return partes.join("\n")
}
