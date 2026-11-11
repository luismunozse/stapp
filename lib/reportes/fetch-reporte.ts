/**
 * Fetch compartido de los reportes de /reportes.
 *
 * Los reportes Profesionales contestan 403 con `code: "FEATURE_REQUIRED"`
 * cuando la organización no tiene `advanced_reports`. Antes cada gráfico lo
 * metía en la misma bolsa que un 500 y el dueño de un taller Free veía "Error
 * al cargar datos": parecía que el sistema estaba roto, no que era una función
 * del plan. Acá se separan los tres desenlaces para que la UI dibuje la
 * invitación a pasarse de plan y deje el error (con "Reintentar") para los
 * errores de verdad.
 */

export type ResultadoReporte<T> =
  | { estado: "ok"; data: T }
  | { estado: "bloqueado" }
  | { estado: "error"; mensaje: string }

export const MENSAJE_ERROR_REPORTE = "No se pudo cargar el reporte. Probá de nuevo en un rato."
export const MENSAJE_SIN_CONEXION = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo."

export async function fetchReporte<T>(
  url: string,
  init?: RequestInit,
): Promise<ResultadoReporte<T>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return { estado: "error", mensaje: MENSAJE_SIN_CONEXION }
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const cuerpo = body && typeof body === "object" ? (body as Record<string, unknown>) : null
    if (res.status === 403 && cuerpo?.code === "FEATURE_REQUIRED") {
      return { estado: "bloqueado" }
    }
    const mensaje =
      typeof cuerpo?.error === "string" && cuerpo.error ? cuerpo.error : MENSAJE_ERROR_REPORTE
    return { estado: "error", mensaje }
  }

  try {
    return { estado: "ok", data: (await res.json()) as T }
  } catch {
    return { estado: "error", mensaje: MENSAJE_ERROR_REPORTE }
  }
}
