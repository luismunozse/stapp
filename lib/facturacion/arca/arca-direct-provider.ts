/**
 * Proveedor de facturación electrónica que emite DIRECTO contra el WSFEv1 de
 * ARCA, sin intermediario (design ADR-01). Hermano de
 * `tusfacturas-provider.ts`: misma interfaz `FacturacionProvider`, misma
 * regla de no propagar excepciones — un fallo se reporta como
 * `{ ok: false, errores }`.
 *
 * El ciclo de vida del ticket WSAA NO se delega en `@arcasdk/core`: lo maneja
 * `renewWsaaTicket` (doble lectura + lease + piso anti-tight-loop) y el
 * resultado se le inyecta al SDK con `handleTicket: true`. Ver
 * `lib/facturacion/arca/wsaa-login.ts` para el porqué.
 */

import { Arca, Voucher } from "@arcasdk/core"
import type { ArcaServiceName } from "@arcasdk/core"
// `INextVoucher` e `IVoucher` no se re-exportan desde la raíz del paquete (el
// barrel de `domain` solo expone entities y value-objects), así que se importan
// por ruta interna. Es deliberado: con la versión pinneada a 2.0.0, si el SDK
// reestructura sus tipos preferimos que `tsc` falle fuerte en el upgrade antes
// que mantener una copia local del tipo que derive en silencio.
import type { INextVoucher, IVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"

import { buildVoucher, datosFiscalesDesdeVoucher } from "@/lib/facturacion/arca/voucher"
import { toLoginCredentials, wsaaLogin } from "@/lib/facturacion/arca/wsaa-login"
import {
  renewWsaaTicket,
  WSAA_SERVICE_WSFE,
  type RenewWsaaTicketOptions,
  type WsaaTicket,
} from "@/lib/facturacion/arca/wsaa-ticket-store"
import { esNotaCreditoFiscal } from "@/lib/facturacion/cbte-tipo"
import { ErrorDeNegocioFacturacion, mensajeSeguroDeError } from "@/lib/facturacion/errores"
import { deriveTipo } from "@/lib/facturacion/derive"
import { formatearNumeroComprobante } from "@/lib/facturacion/numero-comprobante"
import type {
  ArcaCredenciales,
  ComprobanteRef,
  ComprobanteResult,
  ConsultaResult,
  DiagnosticoResult,
  EmitirInput,
  FacturacionProvider,
  PuntoVenta,
  ResultadoNotaCredito,
  SoportaConsulta,
  SoportaDiagnostico,
  SoportaNotaCredito,
  SoportaUltimoNumero,
} from "@/lib/facturacion/types"

const SERVICE: ArcaServiceName = WSAA_SERVICE_WSFE

interface ArcaLike {
  electronicBillingService: {
    createNextVoucher(request: INextVoucher): Promise<any>
    /** Envía el voucher con el número que trae (`CbteDesde`/`CbteHasta`). */
    createVoucher(request: IVoucher): Promise<any>
    /** `FECompConsultar`. `null` cuando no hay resultado (también ante errores de autenticación). */
    getVoucherInfo(number: number, salesPoint: number, type: number): Promise<any | null>
    getLastVoucher(salesPoint: number, type: number): Promise<any>
    getSalesPoints(): Promise<any>
  }
}

export type ArcaDirectProvider = FacturacionProvider<ArcaCredenciales> &
  SoportaDiagnostico<ArcaCredenciales> &
  SoportaConsulta<ArcaCredenciales> &
  SoportaUltimoNumero<ArcaCredenciales> &
  SoportaNotaCredito<ArcaCredenciales>

/**
 * `FEParamGetPtosVenta` devuelve este código cuando el CUIT no tiene puntos de
 * venta dados de alta. NO es un fallo de delegación: significa que AFIP nos
 * atendió en nombre de ese contribuyente y no encontró nada que listar.
 */
const AFIP_SIN_RESULTADOS = 602

export interface ArcaDirectProviderDeps {
  renewTicket?: (options: RenewWsaaTicketOptions) => Promise<WsaaTicket>
  createArca?: (context: any) => ArcaLike
  now?: () => Date
}

/** AAAAMMDD en hora argentina: AFIP valida `CbteFch` contra su propia fecha. */
function fechaComprobante(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "")
}

/**
 * AFIP reporta el problema en dos lugares distintos: `Errors.Err` cuando la
 * request entera es inválida, y `FECAEDetResponse[].Observaciones.Obs` cuando
 * el comprobante puntual fue rechazado. Se juntan los dos.
 */
function extraerErrores(response: any): string[] {
  const errores: string[] = []

  for (const err of response?.Errors?.Err ?? []) {
    errores.push(`${err?.Code ?? "?"}: ${err?.Msg ?? "error sin mensaje"}`)
  }

  for (const det of response?.FeDetResp?.FECAEDetResponse ?? []) {
    for (const obs of det?.Observaciones?.Obs ?? []) {
      errores.push(`${obs?.Code ?? "?"}: ${obs?.Msg ?? "observación sin mensaje"}`)
    }
  }

  return errores.length > 0 ? errores : ["ARCA rechazó el comprobante sin detallar el motivo"]
}

function erroresDeAfip(respuesta: any): Array<{ code?: number; msg?: string }> {
  return respuesta?.errors?.err ?? []
}

function descripcionDeErrores(errores: Array<{ code?: number; msg?: string }>): string {
  return errores.map((e) => `${e.code ?? "?"}: ${e.msg ?? ""}`).join("; ")
}

/**
 * Los lectores (`consultar`, `ultimoAutorizado`) lanzan: quien los llama
 * necesita distinguir "ARCA dijo que no" de "no pude preguntar". El mensaje es
 * genérico y el detalle crudo va al log (ver `mensajeSeguroDeError`).
 */
function errorParaLaRuta(e: unknown, contexto: string): Error {
  return new Error(mensajeSeguroDeError(e, contexto))
}

const ENTERO_O_DECIMAL = /^-?\d+(\.\d+)?$/

/** Número finito desde un número o un texto numérico; cualquier otra cosa, `undefined`. */
function aNumero(valor: unknown): number | undefined {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : undefined
  if (typeof valor === "string" && ENTERO_O_DECIMAL.test(valor.trim())) return Number(valor)
  return undefined
}

function aTexto(valor: unknown): string | undefined {
  if (typeof valor === "string") return valor.trim() === "" ? undefined : valor.trim()
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor)
  return undefined
}

/** Número de documento como cadena de dígitos (el SDK lo entrega como número). */
function aDigitos(valor: unknown): string | undefined {
  if (typeof valor === "number") return Number.isSafeInteger(valor) && valor >= 0 ? String(valor) : undefined
  if (typeof valor === "string" && /^\d+$/.test(valor.trim())) return valor.trim()
  return undefined
}

/**
 * `VoucherInfo` del SDK -> `ConsultaResult`. Los nombres del SDK difieren de los
 * nuestros (`impIVA`, `codAutorizacion`, `fchVto`, `monId`, `monCotiz`) y un
 * valor ilegible queda sin informar: el armado de la NC lo rechaza como error de
 * negocio en vez de operar con un importe inventado.
 */
function mapearConsulta(info: any): ConsultaResult {
  const desde = aNumero(info.cbteDesde)
  const hasta = aNumero(info.cbteHasta)

  return {
    existe: true,
    cbteNro: desde !== undefined && desde === hasta ? desde : undefined,
    cae: aTexto(info.codAutorizacion),
    caeVencimiento: aTexto(info.fchVto),
    resultado: aTexto(info.resultado),
    cbteFch: aTexto(info.cbteFch),
    concepto: aNumero(info.concepto),
    docTipo: aNumero(info.docTipo),
    docNro: aDigitos(info.docNro),
    impTotal: aNumero(info.impTotal),
    impNeto: aNumero(info.impNeto),
    impIva: aNumero(info.impIVA),
    impTrib: aNumero(info.impTrib),
    impOpEx: aNumero(info.impOpEx),
    impTotConc: aNumero(info.impTotConc),
    moneda: aTexto(info.monId),
    cotizacion: aNumero(info.monCotiz),
  }
}

const MENSAJE_NC_SIN_CONFIRMAR =
  "ARCA respondió sin confirmar la nota de crédito. Verificala con ARCA antes de volver a intentar."

/**
 * Chequeos que dejan claro que NADA salió hacia ARCA: se hacen antes de
 * autenticar y de enviar, y su falla es `rechazada` (reintentar es seguro).
 *
 * El `Voucher.create` del SDK corre acá además de dentro de `createVoucher`: si
 * la validación fallara adentro, esa excepción se confundiría con un corte de red
 * y la NC quedaría "incierta" sin que ARCA haya recibido nada.
 */
function validarNotaCreditoAntesDeEnviar(voucher: IVoucher): void {
  if (!esNotaCreditoFiscal(voucher.CbteTipo)) {
    throw new ErrorDeNegocioFacturacion("El comprobante a enviar no es una nota de crédito electrónica (tipo 8 o 13).")
  }

  // Numeración explícita: la NC va con el número reservado en su fila, nunca con
  // el "próximo" que elegiría el SDK (una segunda NC si la primera ya salió).
  if (!Number.isInteger(voucher.CbteDesde) || voucher.CbteDesde < 1 || voucher.CbteDesde !== voucher.CbteHasta) {
    throw new ErrorDeNegocioFacturacion(
      "La nota de crédito se envía con un único número explícito (CbteDesde y CbteHasta iguales)."
    )
  }

  Voucher.create(voucher)
}

/**
 * Qué pasó con una NC que SÍ salió hacia ARCA y devolvió una respuesta.
 *
 * Solo hay dos certezas: autorizada (A con CAE, vencimiento y el mismo número) y
 * rechazada (ARCA devolvió `Resultado` "R", en la cabecera o en el comprobante).
 * Cualquier otra cosa es `incierta`, incluida una respuesta con `Errors.Err` de
 * nivel pedido pero sin `Resultado` (códigos internos 500/501/502 "Error
 * interno"): ARCA pudo haberla emitido igual y marcarla rechazada llevaría a
 * emitir una segunda. La fila queda pendiente y `verificar` la resuelve.
 */
function clasificarRespuestaNotaCredito(resultado: any, voucher: IVoucher): ResultadoNotaCredito {
  const response = resultado?.response
  const detalle = response?.FeDetResp?.FECAEDetResponse?.[0]

  if (detalle?.Resultado === "A") {
    const cae = aTexto(resultado?.cae)
    const caeVencimiento = aTexto(resultado?.caeFchVto)
    const numeroDevuelto = aNumero(detalle.CbteDesde)
    const mismoNumero = numeroDevuelto === undefined || numeroDevuelto === voucher.CbteDesde

    if (cae && caeVencimiento && mismoNumero) {
      return {
        kind: "autorizada",
        numero: formatearNumeroComprobante(voucher.PtoVta, voucher.CbteDesde),
        cae,
        caeVencimiento,
        raw: response,
      }
    }
  } else {
    const rechazada = detalle?.Resultado === "R" || response?.FeCabResp?.Resultado === "R"

    if (rechazada) return { kind: "rechazada", errores: extraerErrores(response), raw: response }
  }

  console.error("[facturacion] respuesta de ARCA sin resultado concluyente para la nota de crédito", resultado)
  return { kind: "incierta", error: MENSAJE_NC_SIN_CONFIRMAR }
}

export function createArcaDirectProvider(deps: ArcaDirectProviderDeps = {}): ArcaDirectProvider {
  const renewTicket = deps.renewTicket ?? renewWsaaTicket
  const createArca = deps.createArca ?? ((context) => new Arca(context) as ArcaLike)
  const now = deps.now ?? (() => new Date())

  /**
   * Renueva el ticket bajo el lease y devuelve un cliente con el TA ya
   * inyectado. Es el único lugar que arma el `Context`, así que emisión y
   * diagnóstico no pueden divergir en cómo se autentican.
   */
  async function clienteAutenticado(creds: ArcaCredenciales): Promise<ArcaLike> {
    const ticket = await renewTicket({
      key: {
        organizationId: creds.organizationId,
        cuit: creds.cuit,
        service: SERVICE,
        production: creds.production,
      },
      login: () =>
        wsaaLogin({
          cuit: creds.cuit,
          certPem: creds.certPem,
          keyPem: creds.keyPem,
          production: creds.production,
          service: SERVICE,
        }),
    })

    return createArca({
      production: creds.production,
      // El emisor del comprobante es el representado cuando la org delegó
      // el servicio; en BYO es el propio titular del certificado.
      cuit: Number(creds.cuitRepresentado ?? creds.cuit),
      cert: creds.certPem,
      key: creds.keyPem,
      handleTicket: true,
      credentials: toLoginCredentials(ticket),
      // Ver wsaa-login.ts: sin el agente legacy, produccion falla con
      // `dh key too small` antes de llegar a AFIP.
      useHttpsAgent: true,
    })
  }

  return {
    /**
     * Le pregunta a AFIP si puede operar en nombre de este contribuyente.
     * En delegación es la ÚNICA verificación posible: el trámite vive del
     * lado de AFIP y no hay nada que validar localmente.
     */
    async probarConexion(creds: ArcaCredenciales): Promise<DiagnosticoResult> {
      try {
        const arca = await clienteAutenticado(creds)
        const respuesta = await arca.electronicBillingService.getSalesPoints()

        const errores = erroresDeAfip(respuesta)
        const soloSinResultados =
          errores.length > 0 && errores.every((e) => e.code === AFIP_SIN_RESULTADOS)

        if (errores.length > 0 && !soloSinResultados) {
          return { ok: false, error: descripcionDeErrores(errores) }
        }

        const puntosVenta: PuntoVenta[] = (respuesta?.resultGet?.ptoVenta ?? []).map((p: any) => ({
          numero: Number(p.nro),
          bloqueado: p.bloqueado === "S",
        }))

        return { ok: true, puntosVenta }
      } catch (e: any) {
        return { ok: false, error: e?.message ?? "No se pudo contactar a ARCA" }
      }
    },

    async emitir(creds: ArcaCredenciales, input: EmitirInput): Promise<ComprobanteResult> {
      const tipo = deriveTipo(creds.condicionFiscal)

      try {
        const arca = await clienteAutenticado(creds)

        const voucher = buildVoucher(creds, input, { cbteFch: fechaComprobante(now()) })
        const resultado = await arca.electronicBillingService.createNextVoucher(voucher)

        const detalle = resultado?.response?.FeDetResp?.FECAEDetResponse?.[0]

        if (resultado?.cae && detalle?.Resultado === "A") {
          return {
            ok: true,
            tipo,
            numero: formatearNumeroComprobante(creds.puntoVenta, detalle?.CbteDesde ?? 0),
            cae: resultado.cae,
            caeVencimiento: resultado.caeFchVto,
            raw: resultado.response,
            // Mismo CUIT que va en `Auth.Cuit`: el representado si hay delegación.
            fiscal: datosFiscalesDesdeVoucher(voucher, creds.cuitRepresentado ?? creds.cuit),
          }
        }

        return { ok: false, tipo, errores: extraerErrores(resultado?.response), raw: resultado?.response ?? null }
      } catch (e: any) {
        return { ok: false, tipo, errores: [mensajeSeguroDeError(e, "fallo emitiendo contra ARCA")], raw: null }
      }
    },

    /**
     * `FECompConsultar` de un comprobante. `existe: false` es lo que dice el SDK
     * cuando no hay resultado, y el SDK también lo dice ante errores de
     * autenticación: NUNCA alcanza por sí solo para afirmar que ARCA no emitió
     * nada (ver `decidirConciliacion`). Lanza ante cualquier falla técnica.
     */
    async consultar(creds: ArcaCredenciales, ref: ComprobanteRef): Promise<ConsultaResult> {
      try {
        const arca = await clienteAutenticado(creds)
        const info = await arca.electronicBillingService.getVoucherInfo(ref.cbteNro, ref.puntoVenta, ref.cbteTipoAfip)

        if (!info) return { existe: false }

        // Con errores, la respuesta no es confiable para operar con importes.
        const errores = erroresDeAfip(info)
        if (errores.length > 0) {
          throw new Error(`FECompConsultar respondió con errores: ${descripcionDeErrores(errores)}`)
        }

        return mapearConsulta(info)
      } catch (e: unknown) {
        throw errorParaLaRuta(e, "fallo consultando el comprobante en ARCA")
      }
    },

    /**
     * Último número autorizado del punto de venta y tipo (`0` si no hay ninguno).
     * Lanza si ARCA informa errores o el número no es un entero válido: numerar
     * sobre un dato dudoso es lo que llevaría a una NC duplicada.
     */
    async ultimoAutorizado(creds: ArcaCredenciales, pv: number, cbteTipo: number): Promise<number> {
      try {
        const arca = await clienteAutenticado(creds)
        const respuesta = await arca.electronicBillingService.getLastVoucher(pv, cbteTipo)

        // Con errores el número puede venir en 0 aunque haya comprobantes.
        const errores = erroresDeAfip(respuesta)
        if (errores.length > 0) {
          throw new Error(`FECompUltimoAutorizado respondió con errores: ${descripcionDeErrores(errores)}`)
        }

        const numero = respuesta?.cbteNro
        if (!Number.isInteger(numero) || numero < 0) {
          throw new Error(`FECompUltimoAutorizado devolvió un número inválido: ${String(numero)}`)
        }

        return numero
      } catch (e: unknown) {
        throw errorParaLaRuta(e, "fallo consultando el último comprobante autorizado en ARCA")
      }
    },

    /**
     * Envía una nota de crédito YA armada y numerada. Nunca lanza.
     *
     * La frontera entre `rechazada` e `incierta` es el `createVoucher`: lo que
     * falla antes (validación, autenticación) no llegó a ARCA y es `rechazada`;
     * una excepción de `createVoucher` ya pudo haber llegado y es `incierta`.
     * Un fallo de autenticación DENTRO de `createVoucher` (el SDK pide el ticket
     * en cada llamada) también cae en `incierta`: se prefiere una verificación
     * de más antes que arriesgar una segunda NC.
     */
    async emitirNotaCredito(creds: ArcaCredenciales, voucher: IVoucher): Promise<ResultadoNotaCredito> {
      let arca: ArcaLike
      try {
        validarNotaCreditoAntesDeEnviar(voucher)
        arca = await clienteAutenticado(creds)
      } catch (e: unknown) {
        return {
          kind: "rechazada",
          errores: [mensajeSeguroDeError(e, "fallo preparando el envío de la nota de crédito a ARCA")],
          raw: null,
        }
      }

      let resultado: any
      try {
        resultado = await arca.electronicBillingService.createVoucher(voucher)
      } catch (e: unknown) {
        return { kind: "incierta", error: mensajeSeguroDeError(e, "fallo enviando la nota de crédito a ARCA") }
      }

      return clasificarRespuestaNotaCredito(resultado, voucher)
    },
  }
}

export const arcaDirectProvider = createArcaDirectProvider()
