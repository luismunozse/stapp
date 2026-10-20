/**
 * Armado del comprobante WSFEv1 (`FECAESolicitar`) a partir del
 * `EmitirInput` genérico de STApp.
 *
 * Slice 1 cubre Factura B y C, que es lo que `deriveTipo` deriva hoy
 * (monotributo → C, responsable inscripto → B). Factura A queda fuera.
 */

// `INextVoucher` no se re-exporta desde la raíz del paquete (el barrel de
// `domain` solo expone entities y value-objects), así que se importa por ruta
// interna. Es deliberado: con la versión pinneada a 2.0.0, si el SDK
// reestructura sus tipos preferimos que `tsc` falle fuerte en el upgrade antes
// que mantener una copia local del tipo que derive en silencio.
import type { INextVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"

import { ErrorDeNegocioFacturacion } from "@/lib/facturacion/errores"
import { deriveTipo } from "@/lib/facturacion/derive"
import type { ArcaCredenciales, DatosFiscales, EmitirInput } from "@/lib/facturacion/types"

/** Códigos de `FEParamGetTiposCbte`. */
const CBTE_TIPO: Record<"B" | "C", number> = { B: 6, C: 11 }

/** Códigos de `FEParamGetTiposIva`, indexados por la alícuota en porcentaje. */
const ALICUOTA_ID: Record<number, number> = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
  5: 8,
  2.5: 9,
}

/** Códigos de `FEParamGetTiposDoc`. */
const DOC_TIPO: Record<string, number> = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  "CONSUMIDOR FINAL": 99,
}

/** Códigos de `FEParamGetCondicionIvaReceptor` (obligatorio desde la RG 5616). */
const COND_IVA_RECEPTOR: Record<string, number> = {
  RI: 1,
  "RESPONSABLE INSCRIPTO": 1,
  EX: 4,
  EXENTO: 4,
  CF: 5,
  "CONSUMIDOR FINAL": 5,
  MT: 6,
  MONOTRIBUTO: 6,
  "RESPONSABLE MONOTRIBUTO": 6,
}

function normalizar(valor: string | undefined): string {
  return (valor ?? "").trim().toUpperCase()
}

/**
 * AFIP espera `DocNro` numérico: los guiones y puntos con los que el taller
 * carga un CUIT o un DNI se descartan acá.
 */
function soloDigitos(valor: string | undefined): number {
  const digitos = (valor ?? "").replace(/\D/g, "")
  return digitos === "" ? 0 : Number(digitos)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Id de `FEParamGetTiposIva` para una alícuota. Una desconocida NO cae en 21%:
 * mandar el Id equivocado autorizaría un IVA distinto del cobrado.
 */
function alicuotaId(alicuota: number): number {
  const id = ALICUOTA_ID[alicuota]
  if (id === undefined) throw new ErrorDeNegocioFacturacion(`Alícuota de IVA no soportada por ARCA: ${alicuota}%`)
  return id
}

function aCentavos(n: number): number {
  return Math.round(n * 100)
}

interface DesgloseIva {
  iva: Array<{ Id: number; BaseImp: number; Importe: number }>
  neto: number
  impuestoIva: number
}

/**
 * Factura B: las líneas ya traen el IVA adentro y suman `input.total` (lo que
 * pagó el cliente), así que el IVA se DESPEJA del total en vez de sumarse
 * encima. Antes se trataban como netas y la factura salía un 21% por encima de
 * lo cobrado, sin descuentos ni redondeo.
 *
 * Agrupa POR ALICUOTA, no por ítem: `FECAESolicitar` espera un array de
 * `AlicIva` con una entrada por alícuota distinta, y AFIP rechaza el
 * comprobante si la misma se repite. Si las líneas no cierran con el total, la
 * diferencia se absorbe en el grupo más grande: el total manda.
 */
function desglosarIva(input: EmitirInput): DesgloseIva {
  const totalCentavos = aCentavos(input.total)
  const { desgloseIva } = input

  // Neto e IVA que la venta ya guardó: se respetan si cierran al centavo.
  if (desgloseIva && aCentavos(desgloseIva.neto + desgloseIva.iva) === totalCentavos) {
    const neto = round2(desgloseIva.neto)
    const impuesto = round2(desgloseIva.iva)
    return {
      iva: [{ Id: alicuotaId(desgloseIva.alicuota), BaseImp: neto, Importe: impuesto }],
      neto,
      impuestoIva: impuesto,
    }
  }

  const brutoPorAlicuota = new Map<number, number>()
  for (const item of input.items) {
    const bruto = aCentavos(item.importe ?? item.importeUnitario * item.cantidad)
    brutoPorAlicuota.set(item.alicuotaIva, (brutoPorAlicuota.get(item.alicuotaIva) ?? 0) + bruto)
  }
  if (brutoPorAlicuota.size === 0) brutoPorAlicuota.set(21, 0)

  const diferencia = totalCentavos - [...brutoPorAlicuota.values()].reduce((a, b) => a + b, 0)
  if (diferencia !== 0) {
    const [mayor] = [...brutoPorAlicuota].sort((x, y) => y[1] - x[1])[0]
    brutoPorAlicuota.set(mayor, (brutoPorAlicuota.get(mayor) ?? 0) + diferencia)
  }

  const iva = [...brutoPorAlicuota].map(([alicuota, centavos]) => {
    const bruto = centavos / 100
    const neto = round2(bruto / (1 + alicuota / 100))
    return {
      Id: alicuotaId(alicuota),
      BaseImp: neto,
      Importe: round2(bruto - neto),
    }
  })

  return {
    iva,
    neto: round2(iva.reduce((acc, i) => acc + i.BaseImp, 0)),
    impuestoIva: round2(iva.reduce((acc, i) => acc + i.Importe, 0)),
  }
}

export interface BuildVoucherOptions {
  /** Fecha del comprobante en formato AAAAMMDD (hora argentina). */
  cbteFch: string
}

export function buildVoucher(
  creds: ArcaCredenciales,
  input: EmitirInput,
  options: BuildVoucherOptions
): INextVoucher {
  const tipo = deriveTipo(creds.condicionFiscal)

  // Factura C no discrimina IVA: el neto ES el total, `ImpIVA` va en cero y
  // el array `Iva` NO se manda (AFIP rechaza una C que lo traiga).
  const { iva, neto, impuestoIva } =
    tipo === "C"
      ? { iva: undefined, neto: round2(input.total), impuestoIva: 0 }
      : desglosarIva(input)

  return {
    CantReg: 1,
    PtoVta: creds.puntoVenta,
    CbteTipo: CBTE_TIPO[tipo],
    Concepto: 1, // Productos
    // Ante un tipo de documento o condición desconocidos se cae a consumidor
    // final, que es el receptor que AFIP acepta sin identificar.
    DocTipo: DOC_TIPO[normalizar(input.receptor.documentoTipo)] ?? 99,
    DocNro: soloDigitos(input.receptor.documentoNro),
    CbteFch: options.cbteFch,
    // AFIP valida ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx + ImpTotConc.
    // El desglose se arma para cerrar exacto con `input.total` (lo cobrado), que
    // es el que se informa: nunca se recalcula por encima.
    ImpTotal: round2(input.total),
    ImpTotConc: 0,
    ImpNeto: neto,
    ImpOpEx: 0,
    ImpIVA: impuestoIva,
    ImpTrib: 0,
    MonId: input.moneda,
    MonCotiz: 1,
    CondicionIVAReceptorId: COND_IVA_RECEPTOR[normalizar(input.receptor.condicionIva)] ?? 5,
    ...(iva ? { Iva: iva } : {}),
  }
}

/**
 * Foto fiscal de lo que se le mandó a ARCA, tomada del voucher ya armado: los
 * importes son EXACTAMENTE los autorizados (`ImpTotal`, `ImpNeto`, `ImpIVA`),
 * no un recálculo desde la venta, que puede cambiar después.
 */
export function datosFiscalesDesdeVoucher(voucher: INextVoucher, cuitEmisor: string): DatosFiscales {
  const f = String(voucher.CbteFch)
  return {
    fechaEmision: `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`,
    cuitEmisor: cuitEmisor.replace(/\D/g, ""),
    cbteTipo: voucher.CbteTipo,
    concepto: voucher.Concepto,
    moneda: voucher.MonId,
    cotizacion: voucher.MonCotiz,
    importeNeto: voucher.ImpNeto,
    importeIva: voucher.ImpIVA,
    importeTotal: voucher.ImpTotal,
    receptorDocTipoCod: voucher.DocTipo,
    receptorDocNro: String(voucher.DocNro),
  }
}
