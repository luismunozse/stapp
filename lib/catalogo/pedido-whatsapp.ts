/**
 * Mensaje de pedido para el plan sin `cotizaciones_online`.
 *
 * Esos catálogos no persisten nada: el carrito se arma en el cliente y se manda
 * por WhatsApp al taller. Es una función pura (sin imports de servidor) para
 * poder usarla desde el bundle del navegador; la moneda llega por `formatPrecio`.
 */

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
  if (notas?.trim()) partes.push(`Notas: ${notas.trim()}`)
  return partes.join("\n")
}
