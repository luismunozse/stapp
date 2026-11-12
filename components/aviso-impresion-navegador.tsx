/**
 * Aviso bajo los botones de impresión térmica. Por navegador el largo del
 * papel lo decide el driver: si tiene un papel de largo fijo, expulsa la hoja
 * entera aunque el comprobante sea corto, y eso no se corrige desde la página.
 */
export function AvisoImpresionNavegador() {
  return (
    <p className="text-xs text-muted-foreground">
      ¿Sale con mucho papel en blanco? En las preferencias de la impresora elegí un papel de rollo
      (largo variable) y, en la ventana de impresión, destildá «Encabezados y pies de página».
    </p>
  )
}
