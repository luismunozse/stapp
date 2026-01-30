/**
 * Componente de Skip Links para accesibilidad
 *
 * Permite a usuarios de teclado y screen readers saltar directamente
 * al contenido principal sin navegar por todo el header/navbar.
 *
 * Solo se muestra al recibir focus (Tab), invisible visualmente por defecto.
 */
export function SkipLinks() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      Saltar al contenido principal
    </a>
  )
}
