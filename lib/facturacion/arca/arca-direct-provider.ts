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

import { Arca } from "@arcasdk/core"
import type { ArcaServiceName } from "@arcasdk/core"
// `INextVoucher` no se re-exporta desde la raíz del paquete (el barrel de
// `domain` solo expone entities y value-objects), así que se importa por ruta
// interna. Es deliberado: con la versión pinneada a 2.0.0, si el SDK
// reestructura sus tipos preferimos que `tsc` falle fuerte en el upgrade antes
// que mantener una copia local del tipo que derive en silencio.
import type { INextVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"

import { buildVoucher } from "@/lib/facturacion/arca/voucher"
import { toLoginCredentials, wsaaLogin } from "@/lib/facturacion/arca/wsaa-login"
import {
  renewWsaaTicket,
  type RenewWsaaTicketOptions,
  type WsaaTicket,
} from "@/lib/facturacion/arca/wsaa-ticket-store"
import { deriveTipo } from "@/lib/facturacion/derive"
import type {
  ArcaCredenciales,
  ComprobanteResult,
  DiagnosticoResult,
  EmitirInput,
  FacturacionProvider,
  PuntoVenta,
  SoportaDiagnostico,
} from "@/lib/facturacion/types"

const SERVICE: ArcaServiceName = "wsfe"

interface ArcaLike {
  electronicBillingService: {
    createNextVoucher(request: INextVoucher): Promise<any>
    getSalesPoints(): Promise<any>
  }
}

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

/** Formato legal del número de comprobante: `PPPP-NNNNNNNN`. */
function formatNumero(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`
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

export function createArcaDirectProvider(
  deps: ArcaDirectProviderDeps = {}
): FacturacionProvider<ArcaCredenciales> & SoportaDiagnostico<ArcaCredenciales> {
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
          return { ok: false, error: errores.map((e) => `${e.code ?? "?"}: ${e.msg ?? ""}`).join("; ") }
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
            numero: formatNumero(creds.puntoVenta, detalle?.CbteDesde ?? 0),
            cae: resultado.cae,
            caeVencimiento: resultado.caeFchVto,
            raw: resultado.response,
          }
        }

        return { ok: false, tipo, errores: extraerErrores(resultado?.response), raw: resultado?.response ?? null }
      } catch (e: any) {
        return { ok: false, tipo, errores: [e?.message ?? "Fallo emitiendo contra ARCA"], raw: null }
      }
    },
  }
}

export const arcaDirectProvider = createArcaDirectProvider()
