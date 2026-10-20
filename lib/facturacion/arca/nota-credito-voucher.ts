/**
 * Armado PURO del comprobante WSFEv1 de una nota de crédito (B = 8, C = 13) que
 * anula una factura ya emitida. Sin red ni base de datos: recibe lo que la ruta
 * ya leyó (la fila de la factura y la consulta a ARCA) y devuelve el voucher, o
 * lanza un `ErrorDeNegocioFacturacion` con un motivo que el taller puede leer.
 *
 * Reglas de ARCA que se respetan (WSFE + RG 4540):
 *  - La NC lleva SIEMPRE `CbtesAsoc` apuntando a la factura (error 10197 si no).
 *  - Es la misma letra que la factura y va al MISMO receptor (DocTipo, DocNro y
 *    CondicionIVAReceptorId copiados).
 *  - Los importes son EXACTAMENTE los autorizados en la factura, tal como los
 *    devuelve ARCA: las filas legadas no guardan lo autorizado y la venta puede
 *    haber cambiado.
 *  - `Voucher.validate` del SDK solo conoce los tipos 1/6/11, así que las reglas
 *    de IVA de los tipos 8/13 se validan acá (C: sin `Iva` y `ImpIVA` 0; B: `Iva`
 *    con una alícuota y las sumas cerrando).
 */

import { Voucher } from "@arcasdk/core"
// Mismo criterio que `voucher.ts`: tipo por ruta interna, a propósito.
import type { INextVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"

import { ALICUOTA_ID, condicionIvaReceptorId } from "@/lib/facturacion/arca/voucher"
import { CBTE_TIPO_FACTURA, CBTE_TIPO_NOTA_CREDITO } from "@/lib/facturacion/cbte-tipo"
import { ErrorDeNegocioFacturacion } from "@/lib/facturacion/errores"
import type { ConsultaResult, EmitirInput, TipoComprobante } from "@/lib/facturacion/types"
import { DEFAULT_TIMEZONE, todayInTimeZone } from "@/lib/timezone"

type ItemFactura = EmitirInput["items"][number]

/** Fila de `comprobantes_fiscales` de la factura a anular, en lo que importa para la NC. */
export interface FacturaOriginal {
  /** Letra de la factura. La NC la sigue; NUNCA la de las credenciales actuales. */
  tipo: TipoComprobante
  /** `cbte_tipo` persistido (6 / 11). NULL en filas anteriores a la migración 370. */
  cbteTipo: number | null
  /** `PPPP-NNNNNNNN`. */
  numero: string
  /** `cuit_emisor` persistido. NULL en filas legadas. */
  cuitEmisor: string | null
  /** `receptor_doc_tipo_cod` / `receptor_doc_nro_cod`: solo se cruzan con ARCA si existen. */
  receptorDocTipoCod: number | null
  receptorDocNroCod: string | null
  /** `receptor_condicion_iva` tal como se guardó al emitir ("CF", "RI"...). */
  receptorCondicionIva: string | null
  /** `detalle` JSONB: los ítems tal como se informaron al emitir. */
  detalle: unknown
}

export interface OpcionesNotaCredito {
  /** Punto de venta con el que se emite la NC: el de las credenciales vigentes. */
  puntoVenta: number
  /** CUIT del emisor según las credenciales (el representado si la org delegó). */
  cuitEmisor: string
  /** Instante actual: la NC se fecha con el día de hoy en Argentina. */
  now: Date
}

export interface NotaCreditoArmada {
  /** Sin `CbteDesde`/`CbteHasta`: el número (último + 1) se conoce recién después. */
  voucher: INextVoucher
  /** Líneas que se persisten en la fila de la NC y que imprime su PDF. */
  detalle: ItemFactura[]
}

export interface ContextoDetalleNotaCredito {
  tipo: TipoComprobante
  /** Número de la factura anulada (`PPPP-NNNNNNNN`), para la línea sintética. */
  numero: string
  impTotal: number
  alicuota: number
}

const DOC_TIPO_CONSUMIDOR_FINAL = 99
const COND_IVA_CONSUMIDOR_FINAL = 5
const CONCEPTO_PRODUCTOS = 1
/** Diferencia máxima (en centavos) entre el IVA informado y neto x alícuota. */
const TOLERANCIA_REDONDEO_CENTAVOS = 1

const negocio = (mensaje: string) => new ErrorDeNegocioFacturacion(mensaje)

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const aCentavos = (n: number) => Math.round(n * 100)

function esNumero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor)
}

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "")
}

/** Número de documento comparable: solo dígitos y sin ceros a la izquierda. */
function normalizarDocNro(valor: string): string {
  const digitos = soloDigitos(valor).replace(/^0+/, "")
  return digitos === "" ? "0" : digitos
}

/** `AAAAMMDD` del día de hoy en Argentina: ARCA valida `CbteFch` contra su propia fecha. */
function fechaDeHoy(now: Date): string {
  return todayInTimeZone(DEFAULT_TIMEZONE, now).replaceAll("-", "")
}

/**
 * Alícuota (en porcentaje) de una factura B a partir de su neto e IVA. La
 * consulta de ARCA descarta el array `Iva`, así que se infiere: la única alícuota
 * conocida cuyo IVA esperado difiere en a lo sumo un centavo del informado. Si
 * ninguna encaja, o encajan varias (importes diminutos), no se adivina: mandar
 * el `Id` equivocado autorizaría un IVA distinto del de la factura.
 */
export function inferirAlicuotaIva(impNeto: number, impIva: number): number {
  const netoCentavos = aCentavos(impNeto)
  const ivaCentavos = aCentavos(impIva)

  const candidatas = Object.keys(ALICUOTA_ID)
    .map(Number)
    .filter((alicuota) => {
      const esperado = Math.round((netoCentavos * alicuota) / 100)
      return Math.abs(esperado - ivaCentavos) <= TOLERANCIA_REDONDEO_CENTAVOS
    })

  if (candidatas.length === 0) {
    throw negocio(
      `No se pudo determinar la alícuota de IVA de la factura (IVA ${impIva} sobre un neto de ${impNeto}). No se emitió la nota de crédito.`
    )
  }
  if (candidatas.length > 1) {
    throw negocio(
      `La alícuota de IVA de la factura es ambigua (IVA ${impIva} sobre un neto de ${impNeto}). No se emitió la nota de crédito.`
    )
  }
  return candidatas[0]
}

interface Importes {
  total: number
  neto: number
  iva: number
}

/** Importes de la consulta, validados para una NC con las reglas que el SDK no cubre. */
function validarImportes(tipo: TipoComprobante, consulta: ConsultaResult): Importes {
  const { impTotal, impNeto, impIva } = consulta
  if (!esNumero(impTotal) || !esNumero(impNeto) || !esNumero(impIva)) {
    throw negocio("ARCA no informó los importes de la factura (total, neto e IVA).")
  }
  if (aCentavos(impTotal) <= 0) {
    throw negocio("La factura no tiene un importe positivo para anular.")
  }
  if (consulta.concepto !== CONCEPTO_PRODUCTOS) {
    throw negocio("La anulación automática solo está disponible para facturas de productos.")
  }

  const extras = [consulta.impTrib, consulta.impOpEx, consulta.impTotConc].map((v) => v ?? 0)
  if (!extras.every(esNumero) || extras.some((v) => aCentavos(v) !== 0)) {
    throw negocio(
      "La factura tiene tributos, importes exentos o no gravados: la anulación automática no los contempla. Contactá a soporte."
    )
  }

  if (aCentavos(impNeto) + aCentavos(impIva) !== aCentavos(impTotal)) {
    throw negocio("Los importes de la factura en ARCA no cierran: el neto más el IVA no es igual al total.")
  }
  if (tipo === "C" && aCentavos(impIva) !== 0) {
    throw negocio("La Factura C informada por ARCA discrimina IVA: la nota de crédito C no puede emitirse así.")
  }

  return { total: round2(impTotal), neto: round2(impNeto), iva: round2(impIva) }
}

interface Receptor {
  docTipo: number
  docNro: number
  condicionIva: number
}

/** Receptor de la NC: el de la factura según ARCA, cruzado con la fila cuando esta lo tiene. */
function resolverReceptor(original: FacturaOriginal, consulta: ConsultaResult): Receptor {
  const { docTipo, docNro } = consulta
  if (!esNumero(docTipo) || docTipo <= 0 || docNro === undefined) {
    throw negocio("ARCA no informó el documento del receptor de la factura.")
  }

  if (original.receptorDocTipoCod != null && original.receptorDocTipoCod !== docTipo) {
    throw negocio("El tipo de documento del receptor guardado no coincide con el que tiene ARCA. No se emitió la nota de crédito.")
  }
  if (original.receptorDocNroCod != null && normalizarDocNro(original.receptorDocNroCod) !== normalizarDocNro(docNro)) {
    throw negocio("El documento del receptor guardado no coincide con el que tiene ARCA. No se emitió la nota de crédito.")
  }

  const nro = Number(normalizarDocNro(docNro))
  if (!Number.isSafeInteger(nro)) throw negocio("El documento del receptor informado por ARCA no es válido.")

  // La condición de IVA no sale de la consulta: se copia de la fila. Solo un
  // consumidor final puede prescindir de ella (es el receptor que ARCA acepta
  // sin identificar); a cualquier otro no se le inventa una.
  const condicionIva =
    condicionIvaReceptorId(original.receptorCondicionIva) ??
    (docTipo === DOC_TIPO_CONSUMIDOR_FINAL ? COND_IVA_CONSUMIDOR_FINAL : undefined)
  if (condicionIva === undefined) {
    throw negocio("No se pudo determinar la condición frente al IVA del receptor de la factura. No se emitió la nota de crédito.")
  }

  return { docTipo, docNro: nro, condicionIva }
}

/** `CbtesAsoc` de la NC: la factura anulada. */
function comprobanteAsociado(original: FacturaOriginal, consulta: ConsultaResult, cuitCredenciales: string) {
  if (original.cbteTipo != null && original.cbteTipo !== CBTE_TIPO_FACTURA[original.tipo]) {
    throw negocio("El tipo de comprobante guardado no coincide con la letra de la factura.")
  }

  const partes = /^(\d{1,5})-(\d{1,8})$/.exec(original.numero.trim())
  const ptoVta = partes ? Number(partes[1]) : 0
  const nro = partes ? Number(partes[2]) : 0
  if (ptoVta <= 0 || nro <= 0) {
    throw negocio(`El número de la factura (${original.numero}) no tiene el formato PPPP-NNNNNNNN.`)
  }

  const cuitCreds = soloDigitos(cuitCredenciales)
  const cuitFactura = original.cuitEmisor ? soloDigitos(original.cuitEmisor) : null
  if (cuitFactura && cuitFactura !== cuitCreds) {
    throw negocio(
      "El CUIT emisor de la factura no coincide con el de las credenciales de facturación: no se puede emitir la nota de crédito."
    )
  }
  const cuit = cuitFactura ?? cuitCreds
  if (!/^\d{11}$/.test(cuit)) throw negocio("El CUIT emisor no es válido: tiene que tener 11 dígitos.")

  const cbteFch = String(consulta.cbteFch ?? "")
  if (!/^\d{8}$/.test(cbteFch)) {
    throw negocio("ARCA no informó la fecha de la factura (se esperaba AAAAMMDD).")
  }

  return { Tipo: CBTE_TIPO_FACTURA[original.tipo], PtoVta: ptoVta, Nro: nro, Cuit: cuit, CbteFch: cbteFch }
}

/**
 * Líneas legibles del `detalle` persistido, o `null` si no hay ninguna o alguna
 * no se puede interpretar (una sola línea rota ya impide que el total cierre).
 */
function leerLineas(detalle: unknown): ItemFactura[] | null {
  if (!Array.isArray(detalle) || detalle.length === 0) return null

  const lineas: ItemFactura[] = []
  for (const cruda of detalle) {
    if (typeof cruda !== "object" || cruda === null) return null
    const { cantidad, descripcion, importeUnitario, importe, alicuotaIva } = cruda as Record<string, unknown>
    if (!esNumero(cantidad) || !esNumero(importeUnitario) || !esNumero(alicuotaIva)) return null
    lineas.push({
      cantidad,
      descripcion: typeof descripcion === "string" ? descripcion : "",
      importeUnitario,
      importe: esNumero(importe) ? round2(importe) : round2(importeUnitario * cantidad),
      alicuotaIva,
    })
  }
  return lineas
}

/**
 * Líneas de la NC. Se copian las de la factura solo si suman EXACTAMENTE lo
 * autorizado (al centavo): las facturas anteriores al arreglo de importes
 * guardaron líneas que suman menos que el `ImpTotal` que ARCA autorizó. En
 * cualquier otro caso (sin detalle, ilegible o que no cierra) va UNA línea
 * sintética por el total, que es siempre correcta.
 */
export function detalleNotaCredito(detalleOriginal: unknown, contexto: ContextoDetalleNotaCredito): ItemFactura[] {
  const lineas = leerLineas(detalleOriginal)
  if (lineas) {
    const suma = lineas.reduce((acc, l) => acc + aCentavos(l.importe ?? l.importeUnitario * l.cantidad), 0)
    if (suma === aCentavos(contexto.impTotal)) return lineas
  }

  return [
    {
      cantidad: 1,
      descripcion: `Anulación de la factura ${contexto.tipo} ${contexto.numero}`,
      importeUnitario: contexto.impTotal,
      importe: contexto.impTotal,
      alicuotaIva: contexto.alicuota,
    },
  ]
}

/**
 * Voucher de la NC que anula `original`, con los importes y el receptor que ARCA
 * tiene para esa factura (`consulta`). El número de la NC no va acá: se obtiene
 * después (último autorizado + 1) y la ruta lo agrega como `CbteDesde`/`CbteHasta`.
 */
export function buildNotaCreditoVoucher(
  original: FacturaOriginal,
  consulta: ConsultaResult,
  opciones: OpcionesNotaCredito
): NotaCreditoArmada {
  if (!consulta.existe) throw negocio("ARCA no tiene registrada la factura que se quiere anular.")

  const importes = validarImportes(original.tipo, consulta)
  const receptor = resolverReceptor(original, consulta)
  const asociado = comprobanteAsociado(original, consulta, opciones.cuitEmisor)

  if (!consulta.moneda || !esNumero(consulta.cotizacion) || consulta.cotizacion <= 0) {
    throw negocio("ARCA no informó la moneda o la cotización de la factura.")
  }

  // Factura C no discrimina IVA: ni array `Iva` ni alícuota (ARCA rechaza una C
  // que lo traiga). Factura B: una sola alícuota, la de la factura.
  const alicuota = original.tipo === "B" ? inferirAlicuotaIva(importes.neto, importes.iva) : 0
  const iva =
    original.tipo === "B"
      ? [{ Id: ALICUOTA_ID[alicuota], BaseImp: importes.neto, Importe: importes.iva }]
      : undefined

  const voucher: INextVoucher = {
    CantReg: 1,
    PtoVta: opciones.puntoVenta,
    CbteTipo: CBTE_TIPO_NOTA_CREDITO[original.tipo],
    Concepto: CONCEPTO_PRODUCTOS,
    DocTipo: receptor.docTipo,
    DocNro: receptor.docNro,
    CbteFch: fechaDeHoy(opciones.now),
    ImpTotal: importes.total,
    ImpTotConc: 0,
    ImpNeto: importes.neto,
    ImpOpEx: 0,
    ImpIVA: importes.iva,
    ImpTrib: 0,
    MonId: consulta.moneda,
    MonCotiz: consulta.cotizacion,
    CondicionIVAReceptorId: receptor.condicionIva,
    CbtesAsoc: [asociado],
    ...(iva ? { Iva: iva } : {}),
  }

  // Segunda red: el SDK valida lo que sí conoce (sumas del array `Iva`, total).
  // Si algo se le escapó a las reglas de arriba, falla ACÁ —antes de grabar
  // nada— y no dentro de `createVoucher`, donde un fallo se leería como "ARCA
  // pudo haberla emitido". El número es un placeholder: solo se valida la forma.
  try {
    Voucher.create({ ...voucher, CbteDesde: 1, CbteHasta: 1 })
  } catch (e) {
    throw negocio(`No se pudo armar la nota de crédito: ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    voucher,
    detalle: detalleNotaCredito(original.detalle, {
      tipo: original.tipo,
      numero: original.numero,
      impTotal: importes.total,
      alicuota,
    }),
  }
}
