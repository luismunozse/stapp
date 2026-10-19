// Cliente compartido para emitir un comprobante ARCA desde la UI (POS y detalle
// de venta). Mapea el status del endpoint a un resultado con el mensaje que ve
// el usuario; el servidor sigue siendo la autoridad de cada regla.

const ENDPOINT_EMITIR = "/api/facturacion-electronica/emitir"
const MENSAJE_POR_DEFECTO = "No se pudo emitir el comprobante"

/** Subconjunto del comprobante que devuelve el endpoint (nunca provider_response). */
export interface ComprobanteEmitido {
  id?: string
  tipo?: string
  numero?: string | null
  cae?: string | null
  cae_vencimiento?: string | null
  estado?: string
  pdf_url?: string | null
  error_msg?: string | null
  yaEmitido?: boolean
  [key: string]: unknown
}

export type ResultadoEmision =
  | { kind: "ok"; comprobante: ComprobanteEmitido | null }
  | { kind: "yaEmitido"; comprobante: ComprobanteEmitido | null; message?: string }
  | { kind: "error"; message: string }

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "status" | "json">>

export async function emitirComprobanteArca(
  ventaId: string,
  fetchImpl: FetchLike = fetch
): Promise<ResultadoEmision> {
  try {
    const res = await fetchImpl(ENDPOINT_EMITIR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ventaId }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 200) {
      return { kind: "ok", comprobante: data.comprobante ?? null }
    }
    if (res.status === 409) {
      return {
        kind: "yaEmitido",
        comprobante: data.comprobante ? { ...data.comprobante, yaEmitido: true } : null,
        message: data.error,
      }
    }
    if (res.status === 422) {
      return { kind: "error", message: data.comprobante?.error_msg || data.error || MENSAJE_POR_DEFECTO }
    }
    if (res.status === 403) {
      return {
        kind: "error",
        message: "Facturación electrónica no disponible. Configurá facturación electrónica en Ajustes.",
      }
    }
    return { kind: "error", message: data.error || MENSAJE_POR_DEFECTO }
  } catch {
    return { kind: "error", message: "Error de conexión al emitir el comprobante" }
  }
}
