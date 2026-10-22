import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { CONTACT_EMAIL } from "@/lib/contact"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { decidirConciliacion } from "@/lib/facturacion/arca/conciliar-nota-credito"
import type { DecisionConciliacion, NotaCreditoPorConciliar } from "@/lib/facturacion/arca/conciliar-nota-credito"
import { cargarCredencialesArca } from "@/lib/facturacion/arca/credenciales-ruta"
import {
  COLUMNAS_NC,
  FORMA_ID,
  MSG_NO_DISPONIBLE,
  MSG_NO_ENCONTRADO,
  auditarAnulacion,
  confirmarNotaCredito,
  leerNotaCredito,
} from "@/lib/facturacion/arca/nota-credito-ruta"
import type { ConfirmacionNotaCredito } from "@/lib/facturacion/arca/nota-credito-ruta"
import { esNotaCreditoFiscal } from "@/lib/facturacion/cbte-tipo"
import { MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
import type { ConsultaResult } from "@/lib/facturacion/types"

// Consulta y último autorizado contra ARCA: 60 s en lugar de los 30 generales
// (también en vercel.json).
export const maxDuration = 60

/**
 * "Verificar con ARCA": concilia una nota de crédito que quedó sin resolver con lo
 * que ARCA tiene. `[id]` es el de la NC (no el de la factura).
 *
 * Aplica a una NC `pendiente` (el envío se cortó y no sabemos qué pasó) y a una
 * `rechazado` (por si ARCA igual la emitió: adopción tardía). Una NC `emitido` solo
 * completa la anulación de su factura si había quedado a medias.
 *
 * Reglas que no se negocian:
 *  - NUNCA crea un comprobante en ARCA ni una fila nueva: solo consulta y, si ARCA
 *    ya la tiene, la adopta. Emitir otra NC por una que ARCA ya emitió dejaría la
 *    factura con dos notas de crédito.
 *  - Solo se adopta el número EXACTO que se pidió, y únicamente si ARCA lo tiene
 *    autorizado con los mismos importes, documento y fecha que enviamos.
 *  - "ARCA no la emitió" solo se afirma con el último autorizado en la mano y fuera
 *    del período de gracia: un `null` o un error técnico no prueban nada (la
 *    decisión pura vive en `decidirConciliacion`).
 *  - Ante la duda la NC queda como está y se manda a soporte; ante un error técnico
 *    no se escribe nada (502).
 *  - Solo exige sesión Admin, NO el gate de facturación: una baja de plan no puede
 *    dejar trabada una NC incierta (la sigue frenando la falta de credenciales).
 *  - Sin la migración 371 se responde 503: no hay escalón de respaldo.
 */

/** Lo que esta ruta lee de la fila de la NC (columnas seguras + foto fiscal + anulación). */
const COLUMNAS_VERIFICAR = `${COLUMNAS_NC}, fecha_emision, cuit_emisor, cbte_tipo, importe_total, receptor_doc_tipo_cod, receptor_doc_nro_cod`

interface FilaNotaCredito {
  id: string
  estado: string
  punto_venta: number
  numero: string | null
  cae: string | null
  cae_vencimiento: string | null
  cuit_emisor: string | null
  cbte_tipo: number | null
  fecha_emision: string | null
  importe_total: number | string | null
  receptor_doc_tipo_cod: number | string | null
  receptor_doc_nro_cod: string | null
  comprobante_asociado_id: string | null
  cbte_nro_solicitado: number | null
  motivo: string | null
  created_at: string | null
  updated_at: string | null
}

const MSG_NO_ES_NC = "Solo se puede verificar una nota de crédito electrónica."
const MSG_ESTADO = "Esta nota de crédito no se puede verificar."
const MSG_ARCA_NO_EMITIO = "ARCA no emitió la nota de crédito. Podés volver a anular la factura."
const ERROR_MSG_ARCA_NO_EMITIO = "ARCA no emitió esta nota de crédito (verificado con ARCA)."
const MSG_ESPERAR = "El envío fue hace muy poco y ARCA puede seguir procesándolo: probá en unos minutos."
const MSG_CAMBIO = "La nota de crédito cambió mientras la verificábamos. Actualizá la pantalla."
const MSG_CONFIRMACION =
  "ARCA tiene la nota de crédito pero no pudimos registrarla. No la emitas de nuevo: volvé a usar Verificar con ARCA."

const MENSAJE_SOPORTE = {
  datos_distintos: `ARCA tiene una nota de crédito con ese número pero no coincide con la que enviamos. Contactá a soporte: ${CONTACT_EMAIL}.`,
  numero_ocupado: `ARCA ya usó ese número y no pudimos confirmar si es esta nota de crédito. No la emitas de nuevo: contactá a soporte: ${CONTACT_EMAIL}.`,
  sin_confirmacion: `No pudimos confirmar con ARCA si emitió la nota de crédito. No la emitas de nuevo: contactá a soporte: ${CONTACT_EMAIL}.`,
  no_registrable: `ARCA tiene esta nota de crédito pero no se puede registrar porque choca con otro comprobante. Contactá a soporte: ${CONTACT_EMAIL}.`,
  sin_numero: `La nota de crédito no tiene el número que se pidió a ARCA, así que no se puede verificar. Contactá a soporte: ${CONTACT_EMAIL}.`,
  otro_emisor: `El CUIT emisor de la nota de crédito no coincide con el de las credenciales de facturación actuales: no se puede verificar. Contactá a soporte: ${CONTACT_EMAIL}.`,
  sin_datos_emitida: `La nota de crédito figura emitida pero no tiene número o CAE guardado. Contactá a soporte: ${CONTACT_EMAIL}.`,
} as const

const json = (cuerpo: unknown, status: number) => NextResponse.json(cuerpo, { status })

const soloDigitos = (valor: string) => valor.replace(/\D/g, "")

/** Un NUMERIC o INTEGER de la base como número; todo lo que no sea legible, `null`. */
function aNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null
  if (typeof valor === "string" && valor.trim() !== "") {
    const numero = Number(valor)
    return Number.isFinite(numero) ? numero : null
  }
  return null
}

/** Para soporte: qué NC y por qué razón, sin datos del cliente. */
function paraSoporte(nc: FilaNotaCredito, razon: keyof typeof MENSAJE_SOPORTE) {
  console.warn("[facturacion] verificar: nota de crédito para soporte", { ncId: nc.id, razon })
  return json({ resultado: "soporte", razon, error: MENSAJE_SOPORTE[razon] }, 409)
}

/**
 * Confirma la NC con el RPC atómico (NC emitida + factura anulada) y responde. Sirve a la
 * adopción de lo que tiene ARCA y a completar una NC que ya estaba emitida.
 */
async function confirmarYResponder(
  request: Request,
  organizationId: string,
  userId: string | null | undefined,
  nc: FilaNotaCredito,
  datos: ConfirmacionNotaCredito,
  resultado: "adoptada" | "emitida"
) {
  const facturaId = nc.comprobante_asociado_id!
  const { data, error: rpcError } = await confirmarNotaCredito(organizationId, nc.id, datos)

  if (rpcError) {
    // El RPC es una sola transacción: si falla no queda nada a medias, y reintentar es seguro.
    console.error("[facturacion] verificar: la nota de crédito existe en ARCA pero falló la confirmación", {
      ncId: nc.id,
      cae: datos.cae,
      numero: datos.numero,
      code: rpcError.code,
    })
    // Choques de negocio (otra NC activa, el número ya es de otra NC, la factura cambió de estado,
    // la NC tiene otro CAE): necesitan a una persona. Todo lo demás se puede reintentar.
    const mensaje = rpcError.message ?? ""
    const choque = rpcError.code === "23505" || (rpcError.code === "P0001" && /otro CAE|factura asociada/.test(mensaje))
    if (choque) return paraSoporte(nc, "no_registrable")
    return json({ error: MSG_CONFIRMACION, cae: datos.cae, numero: datos.numero, comprobanteId: nc.id }, 500)
  }

  // Una repetición (replayed) no anuló nada nuevo: no hay nada que auditar.
  if ((data as { replayed?: boolean } | null)?.replayed === false) {
    await auditarAnulacion(request, {
      organizationId,
      userId,
      facturaId,
      notaCredito: datos.numero,
      cae: datos.cae,
      motivo: nc.motivo,
    })
  }

  const { data: emitida } = await leerNotaCredito(nc.id, organizationId)
  return json(
    {
      resultado,
      comprobante: emitida ?? {
        id: nc.id,
        estado: "emitido",
        numero: datos.numero,
        cae: datos.cae,
        cae_vencimiento: datos.caeVencimiento,
      },
      anulado: { id: facturaId },
    },
    200
  )
}

/** ARCA no emitió la NC: pasa a rechazado (reintentar es seguro). Una NC ya rechazada no cambia. */
async function rechazarYResponder(organizationId: string, nc: FilaNotaCredito, ahora: Date) {
  if (nc.estado === "rechazado") {
    const { data: actual } = await leerNotaCredito(nc.id, organizationId)
    return json({ resultado: "rechazada", mensaje: MSG_ARCA_NO_EMITIO, comprobante: actual ?? { id: nc.id, estado: "rechazado" } }, 200)
  }

  // Condicional: si entretanto otro request la adoptó o la rechazó, este UPDATE no pisa nada.
  const { data: rechazada, error: rechazoError } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .update({ estado: "rechazado", error_msg: ERROR_MSG_ARCA_NO_EMITIO, updated_at: ahora.toISOString() })
    .eq("id", nc.id)
    .eq("organization_id", organizationId)
    .eq("estado", "pendiente")
    .select(COLUMNAS_NC)
    .maybeSingle()
  if (rechazoError) {
    console.error("[facturacion] verificar: no se pudo registrar que ARCA no emitió la nota de crédito", rechazoError)
    return json({ error: "No se pudo registrar el resultado de la verificación" }, 500)
  }
  if (!rechazada) {
    const { data: actual } = await leerNotaCredito(nc.id, organizationId)
    return json({ resultado: "cambio", error: MSG_CAMBIO, ...(actual ? { comprobante: actual } : {}) }, 409)
  }
  return json({ resultado: "rechazada", mensaje: MSG_ARCA_NO_EMITIO, comprobante: rechazada }, 200)
}

function responderDecision(
  decision: DecisionConciliacion,
  request: Request,
  organizationId: string,
  userId: string | null | undefined,
  nc: FilaNotaCredito,
  consulta: ConsultaResult,
  ahora: Date
) {
  switch (decision.accion) {
    case "adoptar":
      return confirmarYResponder(
        request,
        organizationId,
        userId,
        nc,
        {
          numero: decision.numero,
          cae: decision.cae,
          caeVencimiento: decision.caeVencimiento,
          // Lo que ARCA tiene, para dejar constancia de que se adoptó por verificación.
          raw: { origen: "verificacion", consulta },
        },
        "adoptada"
      )
    case "rechazar":
      return rechazarYResponder(organizationId, nc, ahora)
    case "esperar":
      return json({ resultado: "esperar", error: MSG_ESPERAR }, 409)
    case "soporte":
      return paraSoporte(nc, decision.razon)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, organizationId, userId } = await requireAdmin()
  if (error) return error
  const org = organizationId!

  const { id } = await params
  if (!FORMA_ID.test(id)) return json({ error: MSG_NO_ENCONTRADO }, 404)

  // ---- la NC: por id Y organización (los números se repiten entre orgs) ----
  const { data: fila, error: cargaError } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .select(COLUMNAS_VERIFICAR)
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle()
  if (cargaError) {
    // Sin la migración 371 no hay notas de crédito que verificar ni escalón de respaldo.
    if (isMissingColumnError(cargaError)) return json({ error: MSG_NO_DISPONIBLE }, 503)
    console.error("[facturacion] no se pudo cargar la nota de crédito a verificar", cargaError)
    return json({ error: "No se pudo cargar el comprobante" }, 500)
  }
  if (!fila) return json({ error: MSG_NO_ENCONTRADO }, 404)
  const nc = fila as unknown as FilaNotaCredito

  // ---- elegibilidad: nada de esto llama a ARCA ----
  if (!nc.comprobante_asociado_id || !esNotaCreditoFiscal(nc.cbte_tipo)) return json({ error: MSG_NO_ES_NC }, 422)

  if (nc.estado === "emitido") {
    // Ya la tiene ARCA y nosotros: solo se completa la anulación de la factura si había quedado a medias.
    if (!nc.numero || !nc.cae || !nc.cae_vencimiento) return paraSoporte(nc, "sin_datos_emitida")
    return confirmarYResponder(
      request,
      org,
      userId,
      nc,
      { numero: nc.numero, cae: nc.cae, caeVencimiento: nc.cae_vencimiento, raw: null },
      "emitida"
    )
  }
  if (nc.estado !== "pendiente" && nc.estado !== "rechazado") return json({ error: MSG_ESTADO }, 409)

  const solicitado = nc.cbte_nro_solicitado
  if (typeof solicitado !== "number" || !Number.isInteger(solicitado) || solicitado < 1) {
    return paraSoporte(nc, "sin_numero")
  }

  // ---- credenciales y emisor ----
  const cargadas = await cargarCredencialesArca(org)
  if (!cargadas.ok) return json({ error: cargadas.error }, cargadas.status)
  const { creds } = cargadas

  // ARCA numera por CUIT + punto de venta + tipo: con las credenciales de otro CUIT la consulta
  // diría "no existe" de una NC que el CUIT original sí emitió, y se la daría por perdida.
  const cuitEmisor = creds.cuitRepresentado ?? creds.cuit
  if (!nc.cuit_emisor || soloDigitos(nc.cuit_emisor) !== soloDigitos(cuitEmisor)) {
    return paraSoporte(nc, "otro_emisor")
  }

  // ---- lo que ARCA tiene de ese número ----
  const cbteTipoAfip = nc.cbte_tipo!
  let consulta: ConsultaResult
  try {
    consulta = await arcaDirectProvider.consultar(creds, {
      puntoVenta: nc.punto_venta,
      cbteTipoAfip,
      cbteNro: solicitado,
    })
  } catch {
    // El proveedor ya logueó el detalle crudo; el mensaje es genérico a propósito.
    return json({ error: MENSAJE_ERROR_TECNICO }, 502)
  }

  // `existe: false` también es lo que el SDK devuelve ante un error de autenticación: solo vale como
  // "no existe" con el último autorizado en la mano.
  let ultimo: number | null = null
  if (!consulta.existe) {
    try {
      ultimo = await arcaDirectProvider.ultimoAutorizado(creds, nc.punto_venta, cbteTipoAfip)
    } catch {
      return json({ error: MENSAJE_ERROR_TECNICO }, 502)
    }
  }

  const ahora = new Date()
  const porConciliar: NotaCreditoPorConciliar = {
    estado: nc.estado,
    puntoVenta: nc.punto_venta,
    cbteNroSolicitado: solicitado,
    importeTotal: aNumero(nc.importe_total),
    receptorDocTipoCod: aNumero(nc.receptor_doc_tipo_cod),
    receptorDocNro: nc.receptor_doc_nro_cod,
    fechaEmision: nc.fecha_emision,
    // `updated_at` se renueva en cada intento; la fila recién creada tiene la hora del envío.
    ultimoIntentoAt: nc.updated_at ?? nc.created_at,
  }

  return responderDecision(decidirConciliacion(porConciliar, consulta, ultimo, ahora), request, org, userId, nc, consulta, ahora)
}
