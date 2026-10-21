/**
 * Formato legal del número de un comprobante electrónico: `PPPP-NNNNNNNN`
 * (punto de venta a 4 dígitos, número a 8). Sin imports: lo usan el proveedor,
 * la conciliación y las rutas sin arrastrar el SDK.
 */
export function formatearNumeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`
}
