/**
 * Formato legal del número de un comprobante electrónico: `PPPP-NNNNNNNN`
 * (punto de venta a 4 dígitos, número a 8). Sin imports: lo usan el proveedor,
 * la conciliación y las rutas sin arrastrar el SDK.
 */
export function formatearNumeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`
}

/**
 * Inversa de `formatearNumeroComprobante`: punto de venta y número de un
 * `PPPP-NNNNNNNN` guardado, o `null` si no tiene ese formato (o alguno vale 0,
 * que ARCA no numera). Tolera anchos más cortos porque la columna es texto libre.
 */
export function parsearNumeroComprobante(
  texto: string | null | undefined
): { puntoVenta: number; numero: number } | null {
  const partes = /^(\d{1,5})-(\d{1,8})$/.exec((texto ?? "").trim())
  if (!partes) return null

  const puntoVenta = Number(partes[1])
  const numero = Number(partes[2])
  return puntoVenta > 0 && numero > 0 ? { puntoVenta, numero } : null
}
