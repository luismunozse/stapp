/**
 * Decisión PURA de conciliar una nota de crédito que quedó sin resolver contra
 * lo que ARCA tiene. Sin red ni base de datos: la ruta de verificación consulta
 * a ARCA y le pasa acá las respuestas.
 *
 * Por qué existe: enviar la NC puede fallar DESPUÉS de que ARCA la emitió (se
 * cortó la respuesta, venció el timeout). La fila queda `pendiente` con el
 * número reservado (`cbte_nro_solicitado`). Marcarla rechazada cuando ARCA sí la
 * emitió, y reintentar, crearía una SEGUNDA nota de crédito. Por eso:
 *
 *  - Solo se ADOPTA el número EXACTO que se solicitó, y únicamente si ARCA lo
 *    muestra autorizado con los mismos importes, documento y fecha que enviamos.
 *  - Un `null` de `FECompConsultar` NUNCA se toma como "no existe": el SDK lo
 *    devuelve cada vez que falta el resultado, errores de autenticación
 *    incluidos. Se confirma con el último número autorizado.
 *  - No se rechaza dentro del período de gracia desde el último envío: ARCA
 *    puede seguir procesando un pedido cuya respuesta no recibimos.
 *
 * LÍMITE CONOCIDO de la adopción: `FECompConsultar` (`mapVoucherInfo` del SDK)
 * descarta `CbtesAsoc`, así que NO se puede comprobar que el comprobante que ARCA
 * muestra en ese número esté asociado a la factura que se quiso anular. La
 * protección descansa en el número exacto que se solicitó, en el índice único
 * `uq_comprobante_nc_numero` y en que coincidan total, tipo y número de documento
 * y fecha. Una NC emitida FUERA de STApp con el mismo CUIT, punto de venta y tipo,
 * y con total, documento y fecha idénticos, podría adoptarse por error. Cuando
 * `verificar` informa `soporte`, soporte debe revisar "Mis comprobantes" en ARCA.
 */

import { formatearNumeroComprobante } from "@/lib/facturacion/numero-comprobante"
import type { ConsultaResult } from "@/lib/facturacion/types"

/**
 * Cuánto hay que esperar, desde el último envío, para afirmar que ARCA no emitió
 * la NC. Tiene que superar el `maxDuration` más alto de las funciones (60 s en
 * `vercel.json`): pasado ese tiempo la invocación que hizo el envío ya terminó.
 */
export const GRACIA_CONCILIACION_MS = 5 * 60 * 1000

/** La NC sin resolver (fila `pendiente`, o `rechazado` en una adopción tardía). */
export interface NotaCreditoPorConciliar {
  estado: "pendiente" | "rechazado"
  puntoVenta: number
  /** `cbte_nro_solicitado`: el número con el que se envió (último autorizado + 1). */
  cbteNroSolicitado: number
  /** Snapshot persistido ANTES de enviar: es lo que mandamos a ARCA. */
  importeTotal: number | null
  receptorDocTipoCod: number | null
  /** Solo dígitos. */
  receptorDocNro: string | null
  /** YYYY-MM-DD. */
  fechaEmision: string | null
  /** Cuándo se intentó el envío por última vez (`updated_at`, o `created_at`). */
  ultimoIntentoAt: Date | string | null
}

export type DecisionConciliacion =
  /** ARCA tiene ESE número autorizado y coincide: completar la NC con su CAE. */
  | { accion: "adoptar"; numero: string; cae: string; caeVencimiento: string }
  /** ARCA no la emitió: marcarla rechazada (reintentar es seguro). */
  | { accion: "rechazar" }
  /** Todavía no se puede afirmar nada: volver a intentar en unos minutos. */
  | { accion: "esperar"; razon: "dentro_de_gracia" }
  /** Requiere una persona: la NC queda como está y no se envía nada. */
  | { accion: "soporte"; razon: "datos_distintos" | "numero_ocupado" | "sin_confirmacion" }

const aCentavos = (importe: number) => Math.round(importe * 100)

/** El CAE y su vencimiento si la consulta es, sin ambigüedad, nuestra NC. */
function datosSiCoincide(
  nc: NotaCreditoPorConciliar,
  consulta: ConsultaResult
): { cae: string; caeVencimiento: string } | null {
  if (consulta.resultado !== "A") return null
  if (consulta.cbteNro !== nc.cbteNroSolicitado) return null
  if (!consulta.cae || !consulta.caeVencimiento) return null

  if (nc.importeTotal === null || consulta.impTotal === undefined) return null
  if (aCentavos(nc.importeTotal) !== aCentavos(consulta.impTotal)) return null

  if (nc.receptorDocTipoCod === null || nc.receptorDocTipoCod !== consulta.docTipo) return null
  if (nc.receptorDocNro === null || nc.receptorDocNro !== consulta.docNro) return null

  if (nc.fechaEmision === null || nc.fechaEmision.replaceAll("-", "") !== consulta.cbteFch) return null

  return { cae: consulta.cae, caeVencimiento: consulta.caeVencimiento }
}

/** `true` solo si el último envío es MÁS VIEJO que la gracia; ante la duda, no. */
function pasoLaGracia(ultimoIntentoAt: Date | string | null, now: Date): boolean {
  if (ultimoIntentoAt === null) return false
  const enviadoEn = new Date(ultimoIntentoAt).getTime()
  if (Number.isNaN(enviadoEn)) return false
  return now.getTime() - enviadoEn > GRACIA_CONCILIACION_MS
}

/**
 * @param consulta respuesta de ARCA para (punto de venta, tipo, `cbteNroSolicitado`).
 * @param ultimo último número autorizado de ese punto de venta y tipo; solo hace
 *   falta cuando `consulta.existe` es `false`. `null` = no se obtuvo.
 */
export function decidirConciliacion(
  nc: NotaCreditoPorConciliar,
  consulta: ConsultaResult,
  ultimo: number | null,
  now: Date
): DecisionConciliacion {
  if (consulta.existe) {
    const datos = datosSiCoincide(nc, consulta)
    if (!datos) return { accion: "soporte", razon: "datos_distintos" }

    return {
      accion: "adoptar",
      numero: formatearNumeroComprobante(nc.puntoVenta, nc.cbteNroSolicitado),
      ...datos,
    }
  }

  // Nunca se rechaza por un dato que no se pudo leer.
  if (ultimo === null || !Number.isInteger(ultimo) || ultimo < 0) {
    return { accion: "soporte", razon: "sin_confirmacion" }
  }
  if (ultimo >= nc.cbteNroSolicitado) return { accion: "soporte", razon: "numero_ocupado" }

  // Una NC ya rechazada no tiene nada que proteger: "rechazar" no cambia nada.
  if (nc.estado === "rechazado" || pasoLaGracia(nc.ultimoIntentoAt, now)) return { accion: "rechazar" }

  return { accion: "esperar", razon: "dentro_de_gracia" }
}
