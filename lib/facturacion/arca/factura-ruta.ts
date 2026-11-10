/**
 * Emisión y verificación de FACTURAS ARCA con número explícito (migración 389).
 *
 * Por qué: la emisión anterior usaba el "próximo número" que elegía el SDK y
 * trataba cualquier excepción como rechazo. Si el envío se cortaba DESPUÉS de que
 * ARCA autorizara (timeout, red), la factura quedaba `rechazado`, el usuario
 * reintentaba y salía una SEGUNDA factura con otro CAE por la misma venta.
 *
 * Ahora se usa el mismo esquema que la nota de crédito:
 *   último autorizado > INSERT de la factura `pendiente` con el número pedido y la
 *   foto de lo que se envía (el candado) > enviar con ese número > resolver.
 *
 * Reglas que no se negocian:
 *  - Un envío incierto NUNCA se marca rechazado: queda `pendiente` y se resuelve
 *    con "Verificar con ARCA", que adopta el CAE si ARCA la emitió.
 *  - Con un CAE ya emitido la fila nunca se borra.
 *  - Todo se filtra por la organización de la sesión (`supabaseAdmin` no pasa por RLS).
 */

import { NextResponse } from "next/server"
import type { IVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"
import { CONTACT_EMAIL } from "@/lib/contact"
import { supabaseAdmin } from "@/lib/supabase"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { decidirConciliacion } from "@/lib/facturacion/arca/conciliar-nota-credito"
import { datosFiscalesDesdeVoucher } from "@/lib/facturacion/arca/voucher"
import { columnasFiscales, SAFE_COLUMNS } from "@/lib/facturacion/comprobante-columns"
import { deriveTipo } from "@/lib/facturacion/derive"
import { MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
import type { ArcaCredenciales, ConsultaResult, EmitirInput, ResultadoFactura } from "@/lib/facturacion/types"

const UNIQUE_VIOLATION = "23505"
const CHECK_VIOLATION = "23514"

const json = (cuerpo: unknown, status: number) => NextResponse.json(cuerpo, { status })

export const MSG_FACTURA_INCIERTA =
  "No pudimos confirmar si ARCA emitió la factura. No la vuelvas a emitir: en unos minutos usá Verificar con ARCA."
const MSG_FACTURA_EN_VUELO =
  "Hay otra factura en proceso en este punto de venta. Probá de nuevo en unos segundos; si queda pendiente, verificala con ARCA."
const MSG_REGISTRO_FALLIDO =
  "ARCA autorizó la factura pero no pudimos registrarla. No la emitas de nuevo: usá Verificar con ARCA."
const MSG_SIN_MIGRACION = "La facturación ARCA está en mantenimiento. Probá de nuevo en unos minutos."

export interface EmitirFacturaArcaParams {
  organizationId: string
  ventaId: string
  total: number
  creds: ArcaCredenciales
  provider: string
  input: EmitirInput
}

/** Qué índice único rechazó el INSERT del candado. */
function conflictoDeUnicidad(error: { message?: string; details?: string }): "venta" | "en_vuelo" | "otro" {
  const texto = `${error.message ?? ""} ${error.details ?? ""}`
  if (texto.includes("uq_comprobante_venta_activo")) return "venta"
  if (texto.includes("uq_comprobante_factura_en_vuelo")) return "en_vuelo"
  return "otro"
}

/** El comprobante activo de la venta (pendiente o emitido), para responder a una carrera. */
async function comprobanteActivo(ventaId: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .select(SAFE_COLUMNS)
    .eq("venta_id", ventaId)
    .eq("organization_id", organizationId)
    .in("estado", ["pendiente", "emitido"])
    .is("comprobante_asociado_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * Emite la factura ARCA de una venta. Llamarla después de todas las validaciones
 * de la ruta: desde acá cada paso puede escribir.
 */
export async function emitirFacturaArca(params: EmitirFacturaArcaParams): Promise<NextResponse> {
  const { organizationId: org, ventaId, total, creds, provider, input } = params

  const base = arcaDirectProvider.armarFactura(creds, input)
  const cuitEmisor = creds.cuitRepresentado ?? creds.cuit

  // ---- numeración explícita: último autorizado + 1 (nada escrito todavía) ----
  let ultimo: number
  try {
    ultimo = await arcaDirectProvider.ultimoAutorizado(creds, base.PtoVta, base.CbteTipo)
  } catch {
    return json({ error: MENSAJE_ERROR_TECNICO }, 502)
  }
  const numero = ultimo + 1

  // ---- el candado: factura pendiente con el número pedido y la foto de lo que se envía ----
  const { data: pend, error: insErr } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .insert({
      organization_id: org,
      venta_id: ventaId,
      // La misma regla que arma el CbteTipo del voucher: el CHECK de la 389 exige que coincidan.
      tipo: deriveTipo(creds.condicionFiscal),
      punto_venta: base.PtoVta,
      provider,
      estado: "pendiente",
      total,
      receptor_doc_tipo: input.receptor.documentoTipo,
      receptor_doc_nro: input.receptor.documentoNro,
      receptor_condicion_iva: input.receptor.condicionIva,
      ...columnasFiscales(datosFiscalesDesdeVoucher(base, cuitEmisor), input.items),
      cbte_nro_solicitado: numero,
    })
    .select("id")
    .single()

  if (insErr) {
    if (insErr.code === UNIQUE_VIOLATION) {
      const conflicto = conflictoDeUnicidad(insErr)
      if (conflicto === "en_vuelo") return json({ error: MSG_FACTURA_EN_VUELO, conflicto }, 409)
      // Otro request ya está emitiendo (o ya emitió) esta venta: se devuelve el activo.
      const activo = await comprobanteActivo(ventaId, org)
      if (activo) return json({ comprobante: activo, yaEmitido: true }, 409)
      return json({ error: "Comprobante en proceso o ya emitido" }, 409)
    }
    if (insErr.code === CHECK_VIOLATION) {
      // Sin la migración 389 el CHECK de la 371 no deja grabar el número pedido en una factura.
      console.error("[facturacion] factura numerada rechazada por el CHECK: ¿falta la migración 389?", insErr)
      return json({ error: MSG_SIN_MIGRACION }, 503)
    }
    console.error("[facturacion] no se pudo reservar la factura", insErr)
    return json({ error: "No se pudo iniciar el comprobante" }, 500)
  }
  if (!pend) return json({ error: "No se pudo iniciar el comprobante" }, 500)

  // ---- enviar con el número reservado ----
  let resultado: ResultadoFactura
  try {
    resultado = await arcaDirectProvider.emitirFacturaNumerada(creds, {
      ...base,
      CbteDesde: numero,
      CbteHasta: numero,
    } satisfies IVoucher)
  } catch (e) {
    // El proveedor no debería lanzar. Si lo hace, el envío pudo haber salido: del lado seguro.
    console.error("[facturacion] emitirFacturaNumerada lanzó", e)
    resultado = { kind: "incierta", error: MSG_FACTURA_INCIERTA }
  }

  if (resultado.kind === "autorizada") {
    return registrarAutorizada(org, pend.id, resultado, ventaId)
  }

  if (resultado.kind === "rechazada") {
    const mensaje = resultado.errores.join("; ")
    // Condicional: si entretanto "verificar" la resolvió, este UPDATE no pisa nada.
    const { data: rechazada, error: rechazoError } = await supabaseAdmin
      .from("comprobantes_fiscales")
      .update({
        estado: "rechazado",
        error_msg: mensaje,
        provider_response: resultado.raw as any,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pend.id)
      .eq("organization_id", org)
      .eq("estado", "pendiente")
      .select(SAFE_COLUMNS)
      .maybeSingle()
    if (!rechazoError && rechazada) {
      return json({ comprobante: rechazada, error: "Rechazado por el proveedor" }, 422)
    }

    // Sin filas puede significar que otro request ya la resolvió: se relee antes de borrar.
    const { data: actual, error: relecturaError } = await supabaseAdmin
      .from("comprobantes_fiscales")
      .select(SAFE_COLUMNS)
      .eq("id", pend.id)
      .eq("organization_id", org)
      .maybeSingle()
    const estadoActual = relecturaError ? null : ((actual as { estado?: string } | null)?.estado ?? null)
    if (actual && estadoActual && estadoActual !== "pendiente") {
      return json({ comprobante: actual, error: estadoActual === "rechazado" ? mensaje : undefined }, estadoActual === "rechazado" ? 422 : 200)
    }
    // ARCA dijo que no: nunca hubo CAE. Dejar el pendiente colgado trabaría la venta y el
    // punto de venta, así que se borra para liberarlos.
    console.error("[facturacion] no se pudo registrar el rechazo de la factura", rechazoError)
    await supabaseAdmin
      .from("comprobantes_fiscales")
      .delete()
      .eq("id", pend.id)
      .eq("organization_id", org)
      .eq("estado", "pendiente")
    return json({ error: "No se pudo registrar el rechazo" }, 500)
  }

  // incierta: ARCA pudo haberla emitido. La fila SIGUE pendiente con su número; solo se
  // deja la marca de cuándo se intentó, que es lo que usa "verificar" para esperar.
  const { error: marcaError } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .update({ error_msg: resultado.error, updated_at: new Date().toISOString() })
    .eq("id", pend.id)
    .eq("organization_id", org)
    .eq("estado", "pendiente")
  if (marcaError) console.error("[facturacion] no se pudo marcar la factura incierta", marcaError)

  return json(
    {
      error: MSG_FACTURA_INCIERTA,
      comprobante: { id: pend.id, estado: "pendiente", cbte_nro_solicitado: numero },
      verificar: true,
    },
    502
  )
}

interface Autorizacion {
  numero: string
  cae: string
  caeVencimiento: string
  raw: unknown
}

/**
 * Pasa la factura pendiente (o rechazada, en una adopción tardía) a `emitido` con el CAE.
 * Condicional al estado: nunca pisa una factura que otro request ya resolvió.
 */
function marcarEmitida(org: string, id: string, datos: Autorizacion, estadosPrevios: string[]) {
  return supabaseAdmin
    .from("comprobantes_fiscales")
    .update({
      estado: "emitido",
      numero: datos.numero,
      cae: datos.cae,
      cae_vencimiento: datos.caeVencimiento,
      provider_response: datos.raw as any,
      error_msg: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", org)
    .in("estado", estadosPrevios)
    .select(SAFE_COLUMNS)
    .maybeSingle()
}

async function registrarAutorizada(org: string, id: string, datos: Autorizacion, ventaId: string) {
  const { data: emitida, error } = await marcarEmitida(org, id, datos, ["pendiente"])
  if (error || !emitida) {
    // ARCA SÍ emitió: la fila pendiente es la única referencia a ese CAE y nunca se borra.
    console.error("[facturacion] factura autorizada pero falló el registro", {
      ventaId,
      comprobanteId: id,
      cae: datos.cae,
      numero: datos.numero,
      code: error?.code,
    })
    return json({ error: MSG_REGISTRO_FALLIDO, cae: datos.cae, numero: datos.numero, comprobanteId: id }, 500)
  }
  return json({ comprobante: emitida }, 200)
}

// ---------------------------------------------------------------------------
// Verificar con ARCA (facturas)
// ---------------------------------------------------------------------------

export interface FacturaPorVerificar {
  id: string
  estado: string
  punto_venta: number
  cuit_emisor: string | null
  cbte_tipo: number | null
  fecha_emision: string | null
  importe_total: number | string | null
  receptor_doc_tipo_cod: number | string | null
  receptor_doc_nro_cod: string | null
  cbte_nro_solicitado: number | null
  created_at: string | null
  updated_at: string | null
}

const MSG_F_ARCA_NO_EMITIO = "ARCA no emitió la factura. Podés volver a emitirla."
const ERROR_MSG_F_ARCA_NO_EMITIO = "ARCA no emitió esta factura (verificado con ARCA)."
const MSG_F_ESPERAR = "El envío fue hace muy poco y ARCA puede seguir procesándolo: probá en unos minutos."
const MSG_F_CAMBIO = "La factura cambió mientras la verificábamos. Actualizá la pantalla."
const MSG_F_ESTADO = "Esta factura no se puede verificar."

const MENSAJE_SOPORTE_FACTURA = {
  datos_distintos: `ARCA tiene una factura con ese número pero no coincide con la que enviamos. Contactá a soporte: ${CONTACT_EMAIL}.`,
  numero_ocupado: `ARCA ya usó ese número y no pudimos confirmar si es esta factura. No la emitas de nuevo: contactá a soporte: ${CONTACT_EMAIL}.`,
  sin_confirmacion: `No pudimos confirmar con ARCA si emitió la factura. No la emitas de nuevo: contactá a soporte: ${CONTACT_EMAIL}.`,
  no_registrable: `ARCA tiene esta factura pero no se puede registrar porque choca con otro comprobante. Contactá a soporte: ${CONTACT_EMAIL}.`,
  sin_numero: `Esta factura no tiene el número que se pidió a ARCA, así que no se puede verificar. Contactá a soporte: ${CONTACT_EMAIL}.`,
  otro_emisor: `El CUIT emisor de la factura no coincide con el de las credenciales de facturación actuales: no se puede verificar. Contactá a soporte: ${CONTACT_EMAIL}.`,
} as const

const soloDigitos = (valor: string) => valor.replace(/\D/g, "")

function aNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function paraSoporte(id: string, razon: keyof typeof MENSAJE_SOPORTE_FACTURA) {
  console.warn("[facturacion] verificar: factura para soporte", { comprobanteId: id, razon })
  return json({ resultado: "soporte", razon, error: MENSAJE_SOPORTE_FACTURA[razon] }, 409)
}

/**
 * Concilia una factura `pendiente` (envío incierto) o `rechazado` (adopción tardía)
 * con lo que ARCA tiene. NUNCA emite: solo consulta y, si ARCA ya la tiene con el
 * número pedido y los mismos datos, la adopta. Misma decisión pura que las NC
 * (`decidirConciliacion`).
 */
export async function verificarFacturaArca(
  org: string,
  factura: FacturaPorVerificar,
  creds: ArcaCredenciales
): Promise<NextResponse> {
  if (factura.estado !== "pendiente" && factura.estado !== "rechazado") return json({ error: MSG_F_ESTADO }, 409)

  const solicitado = factura.cbte_nro_solicitado
  if (typeof solicitado !== "number" || !Number.isInteger(solicitado) || solicitado < 1 || !factura.cbte_tipo) {
    return paraSoporte(factura.id, "sin_numero")
  }

  // ARCA numera por CUIT + punto de venta + tipo: con otro CUIT la consulta diría "no existe".
  const cuitEmisor = creds.cuitRepresentado ?? creds.cuit
  if (!factura.cuit_emisor || soloDigitos(factura.cuit_emisor) !== soloDigitos(cuitEmisor)) {
    return paraSoporte(factura.id, "otro_emisor")
  }

  let consulta: ConsultaResult
  try {
    consulta = await arcaDirectProvider.consultar(creds, {
      puntoVenta: factura.punto_venta,
      cbteTipoAfip: factura.cbte_tipo,
      cbteNro: solicitado,
    })
  } catch {
    return json({ error: MENSAJE_ERROR_TECNICO }, 502)
  }

  let ultimo: number | null = null
  if (!consulta.existe) {
    try {
      ultimo = await arcaDirectProvider.ultimoAutorizado(creds, factura.punto_venta, factura.cbte_tipo)
    } catch {
      return json({ error: MENSAJE_ERROR_TECNICO }, 502)
    }
  }

  const ahora = new Date()
  const decision = decidirConciliacion(
    {
      estado: factura.estado,
      puntoVenta: factura.punto_venta,
      cbteNroSolicitado: solicitado,
      importeTotal: aNumero(factura.importe_total),
      receptorDocTipoCod: aNumero(factura.receptor_doc_tipo_cod),
      receptorDocNro: factura.receptor_doc_nro_cod,
      fechaEmision: factura.fecha_emision,
      ultimoIntentoAt: factura.updated_at ?? factura.created_at,
    },
    consulta,
    ultimo,
    ahora
  )

  switch (decision.accion) {
    case "adoptar": {
      const { data: emitida, error } = await marcarEmitida(
        org,
        factura.id,
        {
          numero: decision.numero,
          cae: decision.cae,
          caeVencimiento: decision.caeVencimiento,
          raw: { origen: "verificacion", consulta },
        },
        ["pendiente", "rechazado"]
      )
      if (error) {
        console.error("[facturacion] verificar: la factura existe en ARCA pero falló el registro", {
          comprobanteId: factura.id,
          cae: decision.cae,
          numero: decision.numero,
          code: error.code,
        })
        // Otra factura activa en la venta o el número ya registrado: necesita a una persona.
        if (error.code === UNIQUE_VIOLATION) return paraSoporte(factura.id, "no_registrable")
        return json({ error: MSG_REGISTRO_FALLIDO, cae: decision.cae, numero: decision.numero }, 500)
      }
      if (!emitida) return json({ resultado: "cambio", error: MSG_F_CAMBIO }, 409)
      return json({ resultado: "adoptada", comprobante: emitida }, 200)
    }
    case "rechazar": {
      if (factura.estado === "rechazado") {
        return json({ resultado: "rechazada", mensaje: MSG_F_ARCA_NO_EMITIO }, 200)
      }
      const { data: rechazada, error } = await supabaseAdmin
        .from("comprobantes_fiscales")
        .update({ estado: "rechazado", error_msg: ERROR_MSG_F_ARCA_NO_EMITIO, updated_at: ahora.toISOString() })
        .eq("id", factura.id)
        .eq("organization_id", org)
        .eq("estado", "pendiente")
        .select(SAFE_COLUMNS)
        .maybeSingle()
      if (error) {
        console.error("[facturacion] verificar: no se pudo registrar que ARCA no emitió la factura", error)
        return json({ error: "No se pudo registrar el resultado de la verificación" }, 500)
      }
      if (!rechazada) return json({ resultado: "cambio", error: MSG_F_CAMBIO }, 409)
      return json({ resultado: "rechazada", mensaje: MSG_F_ARCA_NO_EMITIO, comprobante: rechazada }, 200)
    }
    case "esperar":
      return json({ resultado: "esperar", error: MSG_F_ESPERAR }, 409)
    case "soporte":
      return paraSoporte(factura.id, decision.razon)
  }
}
