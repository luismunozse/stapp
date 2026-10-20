import { NextResponse } from "next/server"
import type { IVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"
import { requireAdmin } from "@/lib/auth-utils"
import { createAuditLogger } from "@/lib/audit"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { cargarCredencialesArca } from "@/lib/facturacion/arca/credenciales-ruta"
import { buildNotaCreditoVoucher } from "@/lib/facturacion/arca/nota-credito-voucher"
import { datosFiscalesDesdeVoucher } from "@/lib/facturacion/arca/voucher"
import { CBTE_TIPO_FACTURA, esNotaCreditoFiscal } from "@/lib/facturacion/cbte-tipo"
import {
  NC_COLUMNS,
  SAFE_COLUMNS,
  SNAPSHOT_COLUMNS,
  columnasFiscales,
} from "@/lib/facturacion/comprobante-columns"
import { ErrorDeNegocioFacturacion, MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
import { parsearNumeroComprobante } from "@/lib/facturacion/numero-comprobante"
import { diasDesdeEmision, excedePlazoNotaCredito } from "@/lib/facturacion/plazo-nota-credito"
import type { ConsultaResult, MotivoNotaCredito, ResultadoNotaCredito } from "@/lib/facturacion/types"

/**
 * Anular una factura ARCA = emitir UNA nota de crédito electrónica (B = 8, C = 13)
 * por el total autorizado, asociada a la factura. La factura pasa a `anulado` en la
 * MISMA transacción que confirma la NC (`confirmar_nota_credito_fiscal`).
 *
 * Orden de la ruta (cada paso puede cortar sin haber escrito nada):
 *   sesión Admin > gate > id > motivo > cargar factura (org) > elegibilidad >
 *   credenciales > consultar la factura en ARCA > armar la NC > último autorizado >
 *   INSERT de la NC pendiente (el candado) > enviar > confirmar.
 *
 * Reglas que no se negocian:
 *  - La NC pendiente se graba ANTES de enviar, con el número pedido y la foto de lo
 *    que se manda: un envío cuyo resultado se desconoce siempre se puede verificar.
 *  - Un envío incierto NUNCA se marca rechazado: reintentar emitiría una SEGUNDA NC.
 *  - Con un CAE ya emitido la fila nunca se borra.
 *  - Todo se filtra por la organización de la sesión (`supabaseAdmin` no pasa por RLS).
 *  - Sin la migración 371 se responde 503: no hay escalón de respaldo.
 */

const FORMA_ID = /^[A-Za-z0-9_-]{1,64}$/
const UNIQUE_VIOLATION = "23505"
const MAX_DETALLE = 500
const MOTIVOS: readonly string[] = ["error_factura", "devolucion_total", "otro"] satisfies readonly MotivoNotaCredito[]

const COLUMNAS_FACTURA = `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}, ${NC_COLUMNS}`
const COLUMNAS_NC = `${SAFE_COLUMNS}, ${NC_COLUMNS}`

const MSG_NO_DISPONIBLE = "La anulación de facturas todavía no está disponible. Contactá a soporte."
const MSG_NO_ENCONTRADO = "Comprobante no encontrado"
const MSG_INCIERTA =
  "No pudimos confirmar si ARCA emitió la nota de crédito. No vuelvas a intentarlo: usá Verificar con ARCA."

/** Lo que esta ruta lee de la fila de la factura (SAFE + foto fiscal + anulación). */
interface FilaFactura {
  id: string
  venta_id: string
  tipo: string
  numero: string | null
  cae: string | null
  estado: string
  provider: string | null
  receptor_doc_tipo: string | null
  receptor_doc_nro: string | null
  receptor_condicion_iva: string | null
  fecha_emision: string | null
  cuit_emisor: string | null
  cbte_tipo: number | null
  receptor_doc_tipo_cod: number | null
  receptor_doc_nro_cod: string | null
  detalle: unknown
  comprobante_asociado_id: string | null
}

type Motivo = { ok: true; motivo: MotivoNotaCredito; detalle: string | null } | { ok: false; error: string }

function leerMotivo(cuerpo: unknown): Motivo {
  const { motivo, motivoDetalle } = (cuerpo ?? {}) as { motivo?: unknown; motivoDetalle?: unknown }

  if (typeof motivo !== "string" || !MOTIVOS.includes(motivo)) {
    return { ok: false, error: "Elegí el motivo de la anulación." }
  }
  if (motivoDetalle !== undefined && motivoDetalle !== null && typeof motivoDetalle !== "string") {
    return { ok: false, error: "El detalle del motivo no es válido." }
  }

  const detalle = typeof motivoDetalle === "string" ? motivoDetalle.trim() : ""
  if (motivo === "otro" && detalle === "") {
    return { ok: false, error: "Contanos el motivo en el detalle." }
  }
  if (detalle.length > MAX_DETALLE) {
    return { ok: false, error: `El detalle puede tener hasta ${MAX_DETALLE} caracteres.` }
  }
  return { ok: true, motivo: motivo as MotivoNotaCredito, detalle: detalle === "" ? null : detalle }
}

const json = (cuerpo: unknown, status: number) => NextResponse.json(cuerpo, { status })

const soloDigitos = (valor: string) => valor.replace(/\D/g, "")

/** La NC activa (pendiente o emitida) de una factura. A lo sumo hay una: lo garantiza un índice único. */
function buscarNotaCreditoActiva(facturaId: string, organizationId: string) {
  return supabaseAdmin
    .from("comprobantes_fiscales")
    .select(COLUMNAS_NC)
    .eq("comprobante_asociado_id", facturaId)
    .eq("organization_id", organizationId)
    .in("estado", ["pendiente", "emitido"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
}

type Conflicto = "nc_activa" | "nc_en_vuelo" | "nc_numero" | "otro"

/** Qué índice único rechazó el INSERT de la NC (viene en el mensaje de Postgres). */
function conflictoDeUnicidad(error: { message?: string; details?: string }): Conflicto {
  const texto = `${error.message ?? ""} ${error.details ?? ""}`
  if (texto.includes("uq_comprobante_nc_activa")) return "nc_activa"
  if (texto.includes("uq_comprobante_nc_en_vuelo")) return "nc_en_vuelo"
  if (texto.includes("uq_comprobante_nc_numero")) return "nc_numero"
  return "otro"
}

async function responderConflicto(error: { message?: string; details?: string }, facturaId: string, organizationId: string) {
  const conflicto = conflictoDeUnicidad(error)

  if (conflicto === "nc_activa") {
    // Otro request (otra pestaña, un doble clic) ganó la carrera: se devuelve SU nota
    // de crédito para que la pantalla la muestre en vez de mostrar un error.
    const { data: ganadora } = await buscarNotaCreditoActiva(facturaId, organizationId)
    return json(
      {
        error: "Esta factura ya tiene una nota de crédito en curso o emitida.",
        conflicto,
        ...(ganadora ? { notaCredito: ganadora } : {}),
      },
      409
    )
  }
  if (conflicto === "nc_en_vuelo") {
    // Puede ser de otra factura (o de otra organización con el mismo CUIT): no se revela de quién.
    return json(
      {
        error:
          "Hay otra nota de crédito pendiente de verificación en este punto de venta. Verificala antes de anular otra factura.",
        conflicto,
      },
      409
    )
  }
  if (conflicto === "nc_numero") {
    return json(
      { error: "El número que le correspondía a la nota de crédito ya lo usó otro comprobante. Probá de nuevo.", conflicto },
      409
    )
  }
  return json({ error: "No se pudo reservar la nota de crédito: ya hay un comprobante en curso.", conflicto }, 409)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, organizationId, userId } = await requireAdmin()
  if (error) return error
  const org = organizationId!

  // El toggle es una preferencia opt-in: se revalida siempre acá, nunca se confía en el cliente.
  if (!(await canEmitirFacturaElectronica(org))) {
    return json({ error: "Facturación electrónica no disponible" }, 403)
  }

  const { id } = await params
  // Los ids son TEXT (cuid): una forma imposible no tiene nada que buscar.
  if (!FORMA_ID.test(id)) return json({ error: MSG_NO_ENCONTRADO }, 404)

  const motivo = leerMotivo(await request.json().catch(() => null))
  if (!motivo.ok) return json({ error: motivo.error }, 400)

  // ---- la factura: por id Y organización (los números se repiten entre orgs) ----
  const { data: fila, error: cargaError } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .select(COLUMNAS_FACTURA)
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle()
  if (cargaError) {
    // Un SELECT con las columnas de la migración 371 que todavía no existe: sin
    // respaldo, anular no tiene sentido sin ella.
    if (isMissingColumnError(cargaError)) return json({ error: MSG_NO_DISPONIBLE }, 503)
    console.error("[facturacion] no se pudo cargar la factura a anular", cargaError)
    return json({ error: "No se pudo cargar el comprobante" }, 500)
  }
  if (!fila) return json({ error: MSG_NO_ENCONTRADO }, 404)
  const factura = fila as unknown as FilaFactura

  // ---- elegibilidad: nada de esto llama a ARCA ----
  if (esNotaCreditoFiscal(factura.cbte_tipo) || factura.comprobante_asociado_id) {
    return json({ error: "Una nota de crédito no se puede anular." }, 422)
  }
  if (factura.provider !== "arca" && factura.provider !== "arca_delegado") {
    return json({ error: "Solo se pueden anular facturas emitidas directamente con ARCA." }, 422)
  }
  const tipo = factura.tipo === "B" || factura.tipo === "C" ? factura.tipo : null
  if (!tipo) return json({ error: "Solo se pueden anular facturas B y C." }, 422)
  if (factura.estado === "anulado") return json({ error: "La factura ya está anulada." }, 409)
  if (factura.estado !== "emitido") return json({ error: "Solo se pueden anular facturas emitidas." }, 409)
  if (!factura.numero || !factura.cae) {
    return json({ error: "La factura no tiene número o CAE: no se puede anular." }, 409)
  }
  const referencia = parsearNumeroComprobante(factura.numero)
  if (!referencia) {
    return json({ error: `El número de la factura (${factura.numero}) no tiene el formato PPPP-NNNNNNNN.` }, 422)
  }

  const { data: activa, error: activaError } = await buscarNotaCreditoActiva(factura.id, org)
  if (activaError) {
    console.error("[facturacion] no se pudo buscar la nota de crédito activa", activaError)
    return json({ error: "No se pudo verificar el estado de la factura" }, 500)
  }
  if (activa) {
    const pendiente = (activa as { estado?: string }).estado === "pendiente"
    return json(
      {
        error: pendiente
          ? "Esta factura tiene una nota de crédito pendiente de verificación: verificala con ARCA."
          : "Esta factura ya tiene una nota de crédito emitida.",
        notaCredito: activa,
      },
      409
    )
  }

  // ---- credenciales y emisor ----
  const cargadas = await cargarCredencialesArca(org)
  if (!cargadas.ok) return json({ error: cargadas.error }, cargadas.status)
  const { creds } = cargadas

  // El CUIT que emite es el representado si la org delegó. La NC tiene que salir por el
  // mismo emisor que la factura: ARCA numera por CUIT + punto de venta + tipo.
  const cuitEmisor = creds.cuitRepresentado ?? creds.cuit
  if (factura.cuit_emisor && soloDigitos(factura.cuit_emisor) !== soloDigitos(cuitEmisor)) {
    return json(
      {
        error:
          "El CUIT emisor de la factura no coincide con el de las credenciales de facturación actuales: no se puede emitir la nota de crédito.",
      },
      409
    )
  }

  // ---- la factura según ARCA: fuente de los importes y del receptor ----
  const cbteTipoOriginal = factura.cbte_tipo ?? CBTE_TIPO_FACTURA[tipo]
  let consulta: ConsultaResult
  try {
    consulta = await arcaDirectProvider.consultar(creds, {
      puntoVenta: referencia.puntoVenta,
      cbteTipoAfip: cbteTipoOriginal,
      cbteNro: referencia.numero,
    })
  } catch {
    // El proveedor ya logueó el detalle crudo; el mensaje es genérico a propósito.
    return json({ error: MENSAJE_ERROR_TECNICO }, 502)
  }

  if (!consulta.existe) {
    // `existe: false` también es lo que el SDK devuelve ante un error de autenticación:
    // solo vale como "no existe" si el último autorizado lo confirma.
    let ultimoOriginal: number
    try {
      ultimoOriginal = await arcaDirectProvider.ultimoAutorizado(creds, referencia.puntoVenta, cbteTipoOriginal)
    } catch {
      return json({ error: MENSAJE_ERROR_TECNICO }, 502)
    }
    if (ultimoOriginal >= referencia.numero) {
      // ARCA dice que ya autorizó ese número pero la consulta no lo devolvió: no se concluye nada.
      return json({ error: MENSAJE_ERROR_TECNICO }, 502)
    }
    return json({ error: "ARCA no tiene registrada esta factura: no se emitió la nota de crédito." }, 422)
  }
  if (String(consulta.cae ?? "").trim() !== factura.cae.trim()) {
    return json(
      {
        error:
          "El CAE que tiene ARCA para esta factura no coincide con el que guardamos: no se emitió la nota de crédito. Contactá a soporte.",
      },
      422
    )
  }

  // ---- armar la NC (puro) ----
  const ahora = new Date()
  let armada: ReturnType<typeof buildNotaCreditoVoucher>
  try {
    armada = buildNotaCreditoVoucher(
      {
        tipo,
        cbteTipo: factura.cbte_tipo,
        numero: factura.numero,
        cuitEmisor: factura.cuit_emisor,
        receptorDocTipoCod: factura.receptor_doc_tipo_cod,
        receptorDocNroCod: factura.receptor_doc_nro_cod,
        receptorCondicionIva: factura.receptor_condicion_iva,
        detalle: factura.detalle,
      },
      consulta,
      { puntoVenta: creds.puntoVenta, cuitEmisor, now: ahora }
    )
  } catch (e) {
    if (e instanceof ErrorDeNegocioFacturacion) return json({ error: e.message }, 422)
    console.error("[facturacion] fallo armando la nota de crédito", e)
    return json({ error: "No se pudo armar la nota de crédito" }, 500)
  }
  const { voucher, detalle } = armada

  // El plazo de la RG 4540 corre desde la fecha de la factura (para las filas legadas, la de ARCA).
  const dias = diasDesdeEmision(factura.fecha_emision ?? consulta.cbteFch, ahora)
  const plazo = { diasDesdeEmision: dias, fueraDePlazo: excedePlazoNotaCredito(dias) }

  // ---- numeración explícita: el último autorizado de la NC + 1 ----
  let ultimoNc: number
  try {
    ultimoNc = await arcaDirectProvider.ultimoAutorizado(creds, voucher.PtoVta, voucher.CbteTipo)
  } catch {
    return json({ error: MENSAJE_ERROR_TECNICO }, 502)
  }
  const numeroNc = ultimoNc + 1

  // ---- el candado: NC pendiente con el número pedido y la foto de lo que se va a enviar ----
  const { data: nc, error: insError } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .insert({
      organization_id: org,
      venta_id: factura.venta_id,
      tipo,
      punto_venta: voucher.PtoVta,
      provider: factura.provider,
      estado: "pendiente",
      total: voucher.ImpTotal,
      receptor_doc_tipo: factura.receptor_doc_tipo,
      receptor_doc_nro: factura.receptor_doc_nro,
      receptor_condicion_iva: factura.receptor_condicion_iva,
      ...columnasFiscales(datosFiscalesDesdeVoucher(voucher, cuitEmisor), detalle),
      comprobante_asociado_id: factura.id,
      cbte_nro_solicitado: numeroNc,
      motivo: motivo.motivo,
      motivo_detalle: motivo.detalle,
    })
    .select("id")
    .single()
  if (insError) {
    if (insError.code === UNIQUE_VIOLATION) return responderConflicto(insError, factura.id, org)
    if (isMissingColumnError(insError)) return json({ error: MSG_NO_DISPONIBLE }, 503)
    console.error("[facturacion] no se pudo reservar la nota de crédito", insError)
    return json({ error: "No se pudo iniciar la nota de crédito" }, 500)
  }
  if (!nc) return json({ error: "No se pudo iniciar la nota de crédito" }, 500)

  // ---- enviar a ARCA con el número reservado ----
  let resultado: ResultadoNotaCredito
  try {
    resultado = await arcaDirectProvider.emitirNotaCredito(creds, {
      ...voucher,
      CbteDesde: numeroNc,
      CbteHasta: numeroNc,
    } satisfies IVoucher)
  } catch (e) {
    // El proveedor no debería lanzar. Si lo hace, el envío pudo haber salido: del lado seguro.
    console.error("[facturacion] emitirNotaCredito lanzó", e)
    resultado = { kind: "incierta", error: MENSAJE_ERROR_TECNICO }
  }

  if (resultado.kind === "autorizada") {
    const { error: rpcError } = await supabaseAdmin.rpc("confirmar_nota_credito_fiscal", {
      p_org_id: org,
      p_nc_id: nc.id,
      p_numero: resultado.numero,
      p_cae: resultado.cae,
      p_cae_vencimiento: resultado.caeVencimiento,
      p_provider_response: resultado.raw,
    })
    if (rpcError) {
      // ARCA SÍ emitió la NC: la fila pendiente es la única referencia a ese CAE y nunca se borra.
      // "Verificar con ARCA" la completa sin emitir otra.
      console.error("[facturacion] nota de credito autorizada pero fallo la confirmacion", {
        ncId: nc.id,
        cae: resultado.cae,
        numero: resultado.numero,
        code: rpcError.code,
      })
      return json(
        {
          error:
            "ARCA autorizó la nota de crédito pero no pudimos registrarla. No la emitas de nuevo: usá Verificar con ARCA.",
          cae: resultado.cae,
          numero: resultado.numero,
          comprobanteId: nc.id,
        },
        500
      )
    }

    if (userId) {
      try {
        await createAuditLogger(org, userId, request).update(
          "comprobantes_fiscales",
          factura.id,
          { estado: "emitido" },
          { estado: "anulado", notaCredito: resultado.numero, cae: resultado.cae, motivo: motivo.motivo }
        )
      } catch (e) {
        // La auditoría no bloquea una anulación que ya salió bien.
        console.error("[facturacion] no se pudo auditar la anulación", e)
      }
    }

    const { data: emitida } = await supabaseAdmin
      .from("comprobantes_fiscales")
      .select(COLUMNAS_NC)
      .eq("id", nc.id)
      .eq("organization_id", org)
      .single()
    return json(
      {
        comprobante: emitida ?? {
          id: nc.id,
          estado: "emitido",
          numero: resultado.numero,
          cae: resultado.cae,
          cae_vencimiento: resultado.caeVencimiento,
        },
        anulado: { id: factura.id },
        ...plazo,
      },
      200
    )
  }

  if (resultado.kind === "rechazada") {
    const mensaje = resultado.errores.join("; ")
    // Condicional: si entretanto "verificar" la adoptó, este UPDATE no pisa nada.
    const { data: rechazada, error: rechazoError } = await supabaseAdmin
      .from("comprobantes_fiscales")
      .update({
        estado: "rechazado",
        error_msg: mensaje,
        provider_response: resultado.raw,
        updated_at: new Date().toISOString(),
      })
      .eq("id", nc.id)
      .eq("organization_id", org)
      .eq("estado", "pendiente")
      .select(COLUMNAS_NC)
      .single()
    if (rechazoError || !rechazada) {
      // Aquí nunca hubo CAE (ARCA dijo que no, o ni salió): dejar el pendiente colgado trabaría
      // el punto de venta en el índice de NC en vuelo, así que se borra para liberarlo.
      console.error("[facturacion] no se pudo registrar el rechazo de la nota de crédito", rechazoError)
      const { error: borradoError } = await supabaseAdmin
        .from("comprobantes_fiscales")
        .delete()
        .eq("id", nc.id)
        .eq("organization_id", org)
        .eq("estado", "pendiente")
      if (borradoError) console.error("[facturacion] tampoco se pudo borrar la nota de crédito pendiente", borradoError)
      return json({ error: mensaje }, 422)
    }
    return json({ error: mensaje, comprobante: rechazada }, 422)
  }

  // incierta: ARCA pudo haberla emitido. La fila SIGUE pendiente (con su número) y no se toca
  // el estado; solo se deja la marca de cuándo se intentó, que es lo que usa "verificar" para
  // esperar a que un envío en curso termine.
  const { error: marcaError } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .update({ error_msg: resultado.error, updated_at: new Date().toISOString() })
    .eq("id", nc.id)
    .eq("organization_id", org)
    .eq("estado", "pendiente")
  if (marcaError) console.error("[facturacion] no se pudo marcar la nota de crédito incierta", marcaError)

  return json(
    {
      error: MSG_INCIERTA,
      comprobante: { id: nc.id, estado: "pendiente", cbte_nro_solicitado: numeroNc },
      verificar: true,
      ...plazo,
    },
    502
  )
}
