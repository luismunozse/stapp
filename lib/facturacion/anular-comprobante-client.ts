// Cliente para anular una factura ARCA desde la ficha de la venta. Habla con dos
// endpoints: "anular" (id de la FACTURA) emite la nota de credito, y "verificar"
// (id de la NOTA DE CREDITO) resuelve un envio cuyo resultado no se conoce.
// Mapea cada status y cada `resultado` del servidor a un resultado con el texto que
// ve el usuario; el servidor sigue siendo la autoridad de cada regla.

import { CONTACT_EMAIL } from "@/lib/contact"
import type { ComprobanteEmitido } from "@/lib/facturacion/emitir-comprobante-client"
// Solo el tipo: se borra al compilar, el modulo sigue siendo importable desde el cliente.
import type { MotivoNotaCredito } from "@/lib/facturacion/types"

const ENDPOINT_COMPROBANTES = "/api/facturacion-electronica/comprobantes"

export type MotivoAnulacion = MotivoNotaCredito

/** Largo maximo del detalle del motivo; la ruta rechaza lo que pase de aca. */
export const MAX_DETALLE_MOTIVO = 500

export const MOTIVOS_ANULACION: ReadonlyArray<{ value: MotivoAnulacion; label: string }> = [
  { value: "error_factura", label: "Error en la factura" },
  { value: "devolucion_total", label: "Devolución total" },
  { value: "otro", label: "Otro" },
]

export function etiquetaMotivoAnulacion(motivo: string | null | undefined): string | null {
  return MOTIVOS_ANULACION.find((m) => m.value === motivo)?.label ?? null
}

export interface DatosAnulacion {
  motivo: MotivoAnulacion
  motivoDetalle?: string
}

export type ResultadoAnulacion =
  | { kind: "ok"; comprobante: ComprobanteEmitido | null; fueraDePlazo: boolean; diasDesdeEmision: number | null }
  /** El envio a ARCA quedo sin respuesta: la nota esta pendiente y se resuelve con "verificar". */
  | { kind: "incierta"; comprobanteId: string | null; message: string }
  /** ARCA la autorizo pero STApp no pudo registrarla: hay que avisar a soporte con el CAE. */
  | { kind: "autorizadaSinRegistrar"; cae: string; numero: string | null; message: string }
  /** Otra pantalla ya hizo algo con la factura: se muestra el texto y se vuelve a leer. */
  | { kind: "conflicto"; message: string }
  /** Se cortó la conexión: no sabemos si el pedido llegó, así que hay que volver a leer antes de reintentar. */
  | { kind: "sinConexion"; message: string }
  /** El servidor contestó que no: la factura sigue como estaba y se puede volver a probar. */
  | { kind: "error"; message: string }

export type ResultadoVerificacion =
  | { kind: "ok"; resultado: "adoptada" | "emitida"; comprobante: ComprobanteEmitido | null; message: string }
  /** ARCA confirmo que NO emitio la nota: se puede volver a anular. */
  | { kind: "noEmitida"; message: string }
  /** El envio fue hace muy poco: ARCA puede seguir procesandolo. */
  | { kind: "esperar"; message: string }
  /** Los datos no cierran: no se toca nada y se escribe a soporte. */
  | { kind: "soporte"; message: string }
  | { kind: "cambio"; message: string }
  | { kind: "autorizadaSinRegistrar"; cae: string; numero: string | null; message: string }
  | { kind: "error"; message: string }

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "status" | "json">>
type Cuerpo = Record<string, unknown>

const MSG_INCIERTA =
  "No pudimos confirmar con ARCA si la nota de crédito quedó emitida. Tocá 'Verificar con ARCA' en unos minutos."
const MSG_ANULAR_POR_DEFECTO = "No se pudo anular la factura"
const MSG_SIN_PERMISO = "No tenés permiso para anular facturas electrónicas."
const MSG_CONFLICTO = "La factura cambió mientras la anulabas. Actualizamos la pantalla con lo que quedó."
const MSG_RED_ANULAR =
  "Se cortó la conexión mientras anulábamos la factura. Antes de volver a intentar, actualizá la pantalla para ver si quedó anulada."
const MSG_VERIFICAR_POR_DEFECTO = "No se pudo verificar la nota de crédito con ARCA"
const MSG_RED_VERIFICAR = "Se cortó la conexión mientras verificábamos con ARCA. Probá de nuevo en unos minutos."
const MSG_NO_EMITIO = "ARCA no emitió la nota de crédito. Podés volver a anular la factura."
const MSG_ESPERAR = "El envío fue hace muy poco y ARCA puede seguir procesándolo: probá en unos minutos."
const MSG_CAMBIO = "La nota de crédito cambió mientras la verificábamos. Actualizá la pantalla."
const MSG_SOPORTE = `No pudimos confirmar la nota de crédito con ARCA. No la emitas de nuevo: contactá a soporte: ${CONTACT_EMAIL}.`
const MSG_RESPUESTA_RARA =
  "No pudimos interpretar la respuesta. Actualizá la pantalla para ver cómo quedó la nota de crédito."
const MSG_ADOPTADA = "ARCA ya tenía la nota de crédito: quedó registrada y la factura figura como anulada."
const MSG_EMITIDA = "La nota de crédito ya estaba emitida y la factura figura como anulada."

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null

const comprobanteDe = (data: Cuerpo): ComprobanteEmitido | null =>
  data.comprobante && typeof data.comprobante === "object" ? (data.comprobante as ComprobanteEmitido) : null

async function leerCuerpo(res: Pick<Response, "json">): Promise<Cuerpo> {
  const data: unknown = await res.json().catch(() => ({}))
  return data && typeof data === "object" ? (data as Cuerpo) : {}
}

/** Un 500 con CAE: ARCA ya emitio la nota, lo unico que fallo fue registrarla en STApp. */
function autorizadaSinRegistrar(data: Cuerpo) {
  const cae = texto(data.cae)
  if (!cae) return null
  return {
    kind: "autorizadaSinRegistrar" as const,
    cae,
    numero: texto(data.numero),
    message: `ARCA autorizó la nota de crédito (CAE ${cae}), pero no pudimos registrarla en STApp. No la emitas de nuevo: escribinos a ${CONTACT_EMAIL} con ese CAE.`,
  }
}

/** "Factura anulada. Se emitió la nota de crédito electrónica B 0003-00000002." */
export function mensajeFacturaAnulada(nota: { tipo?: string | null; numero?: string | null } | null): string {
  // La letra sola ("... electrónica B.") no dice nada: va siempre junto con el numero.
  const identificacion = nota?.numero ? ` ${[nota.tipo, nota.numero].filter(Boolean).join(" ")}` : ""
  return `Factura anulada. Se emitió la nota de crédito electrónica${identificacion}.`
}

export async function anularComprobanteArca(
  facturaId: string,
  datos: DatosAnulacion,
  fetchImpl: FetchLike = fetch
): Promise<ResultadoAnulacion> {
  const detalle = datos.motivoDetalle?.trim()
  try {
    const res = await fetchImpl(`${ENDPOINT_COMPROBANTES}/${encodeURIComponent(facturaId)}/anular`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detalle ? { motivo: datos.motivo, motivoDetalle: detalle } : { motivo: datos.motivo }),
    })
    const data = await leerCuerpo(res)
    const error = texto(data.error)

    if (res.status === 200) {
      return {
        kind: "ok",
        comprobante: comprobanteDe(data),
        fueraDePlazo: data.fueraDePlazo === true,
        diasDesdeEmision: typeof data.diasDesdeEmision === "number" ? data.diasDesdeEmision : null,
      }
    }
    if (res.status === 502 && data.verificar === true) {
      return { kind: "incierta", comprobanteId: texto(comprobanteDe(data)?.id), message: MSG_INCIERTA }
    }
    if (res.status === 500) {
      const sinRegistrar = autorizadaSinRegistrar(data)
      if (sinRegistrar) return sinRegistrar
    }
    if (res.status === 409) return { kind: "conflicto", message: error ?? MSG_CONFLICTO }
    if (res.status === 403) return { kind: "error", message: error ?? MSG_SIN_PERMISO }
    return { kind: "error", message: error ?? MSG_ANULAR_POR_DEFECTO }
  } catch {
    // No sabemos si el pedido llego al servidor: no se afirma nada, se manda a mirar.
    return { kind: "sinConexion", message: MSG_RED_ANULAR }
  }
}

export async function verificarNotaCreditoArca(
  notaCreditoId: string,
  fetchImpl: FetchLike = fetch
): Promise<ResultadoVerificacion> {
  try {
    const res = await fetchImpl(`${ENDPOINT_COMPROBANTES}/${encodeURIComponent(notaCreditoId)}/verificar`, {
      method: "POST",
    })
    const data = await leerCuerpo(res)
    const error = texto(data.error)

    if (res.status === 200) {
      if (data.resultado === "adoptada" || data.resultado === "emitida") {
        return {
          kind: "ok",
          resultado: data.resultado,
          comprobante: comprobanteDe(data),
          message: data.resultado === "adoptada" ? MSG_ADOPTADA : MSG_EMITIDA,
        }
      }
      if (data.resultado === "rechazada") return { kind: "noEmitida", message: texto(data.mensaje) ?? MSG_NO_EMITIO }
      return { kind: "error", message: MSG_RESPUESTA_RARA }
    }
    if (res.status === 409) {
      if (data.resultado === "esperar") return { kind: "esperar", message: error ?? MSG_ESPERAR }
      if (data.resultado === "cambio") return { kind: "cambio", message: error ?? MSG_CAMBIO }
      if (data.resultado === "soporte") {
        if (!error) return { kind: "soporte", message: MSG_SOPORTE }
        // El mail tiene que estar siempre a la vista: es la unica salida de este caso.
        return { kind: "soporte", message: error.includes(CONTACT_EMAIL) ? error : `${error} Contactá a soporte: ${CONTACT_EMAIL}.` }
      }
    }
    if (res.status === 500) {
      const sinRegistrar = autorizadaSinRegistrar(data)
      if (sinRegistrar) return sinRegistrar
    }
    return { kind: "error", message: error ?? MSG_VERIFICAR_POR_DEFECTO }
  } catch {
    return { kind: "error", message: MSG_RED_VERIFICAR }
  }
}
