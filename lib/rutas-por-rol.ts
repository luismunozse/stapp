/**
 * Protección de rutas por rol, para el middleware.
 *
 * Vive suelto y sin dependencias a propósito: el middleware corre en el Edge,
 * donde no entran ni `next/headers` ni el cliente de Supabase, así que esta
 * regla no puede importar nada de `lib/auth-utils`.
 *
 * Es un gate GRUESO, por ruta y rol, y nada más. Los permisos finos por
 * organización —los toggles opt-in como `vendedores_administran_inventario` y
 * `tecnicos_operan_pos`— viven en la BD, que el Edge no puede leer: los
 * resuelven la página y la API, que sí pueden. Por eso una ruta que dependa de
 * un flag se abre acá y se decide allá.
 */

/**
 * Solo ADMIN.
 *
 * NO incluye /caja, que el navbar sí muestra solo al ADMIN pero el middleware
 * nunca frenó: es un hueco preexistente, ajeno a este cambio, y taparlo acá lo
 * escondería en un PR sobre otra cosa.
 */
const RUTAS_ADMIN = [
  "/tecnicos",
  "/vendedores",
  "/configuracion",
  "/emails",
  "/facturacion",
  "/finanzas",
]

/** ADMIN y VENDEDOR. */
const RUTAS_VENDEDOR = ["/reportes", "/proveedores", "/inventario"]

/**
 * ADMIN, VENDEDOR y —a nivel de ruta— TECNICO.
 *
 * El técnico entra siempre; si la org NO habilitó `tecnicos_operan_pos`, lo
 * frena el servidor: requirePosAccess() contesta 403 a toda escritura y la
 * página lo manda de vuelta al panel. Acá no se puede saber.
 */
const RUTAS_POS = ["/pos", "/ventas"]

/** ¿`pathname` está dentro de `base`? Por segmento: /posventa no es /pos. */
function esRuta(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/")
}

function alguna(pathname: string, bases: string[]): boolean {
  return bases.some((base) => esRuta(pathname, base))
}

/** ¿Hay que sacar a este rol de esta ruta y mandarlo al panel? */
export function redirigirPorRol(pathname: string, role: string | null): boolean {
  if (role === "ADMIN") return false

  if (alguna(pathname, RUTAS_ADMIN)) return true
  if (alguna(pathname, RUTAS_VENDEDOR)) return role !== "VENDEDOR"
  if (alguna(pathname, RUTAS_POS)) return role !== "VENDEDOR" && role !== "TECNICO"

  return false
}
