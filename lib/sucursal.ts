export const SUCURSAL_COOKIE = "stapp-sucursal-activa"
const TODAS = "todas"

export interface ResultadoLectura {
  sucursalId: string | null // null => sin filtro de sucursal (ver todas)
  verTodas: boolean
}

interface InputResolucion {
  role: string | null
  userSucursalId: string | null
  cookieSucursalId: string | null
}

/** Resuelve el filtro de sucursal para LECTURAS. */
export function resolveSucursalLectura(input: InputResolucion): ResultadoLectura {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    // TECNICO/VENDEDOR: su sucursal fija, ignora cookie.
    return { sucursalId: input.userSucursalId, verTodas: false }
  }

  // ADMIN: cookie manda. Sin cookie o 'todas' => ver todas.
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return { sucursalId: null, verTodas: true }
  }
  return { sucursalId: input.cookieSucursalId, verTodas: false }
}

/** Resuelve la sucursal CONCRETA para ESCRITURAS (siempre devuelve un id). */
export function resolveSucursalEscritura(
  input: InputResolucion & { principalId: string }
): string {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    return input.userSucursalId ?? input.principalId
  }
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return input.principalId
  }
  return input.cookieSucursalId
}
