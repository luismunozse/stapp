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

import { deriveTipo } from "@/lib/facturacion/derive"
import type { ArcaCredenciales, EmitirInput } from "@/lib/facturacion/types"

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
  return Math.round(n * 100) / 100
}

interface DesgloseIva {
  iva: Array<{ Id: number; BaseImp: number; Importe: number }>
  neto: number
  impuestoIva: number
}

/**
 * Agrupa las líneas POR ALICUOTA, no por ítem: `FECAESolicitar` espera un
 * array de `AlicIva` con una entrada por alícuota distinta, y AFIP rechaza
 * el comprobante si la misma se repite.
 */
function desglosarIva(input: EmitirInput): DesgloseIva {
  const basePorAlicuota = new Map<number, number>()

  for (const item of input.items) {
    const base = item.importeUnitario * item.cantidad
    basePorAlicuota.set(item.alicuotaIva, (basePorAlicuota.get(item.alicuotaIva) ?? 0) + base)
  }

  const iva = [...basePorAlicuota].map(([alicuota, base]) => ({
    Id: ALICUOTA_ID[alicuota] ?? ALICUOTA_ID[21],
    BaseImp: round2(base),
    Importe: round2((base * alicuota) / 100),
  }))

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
      ? { iva: undefined, neto: input.total, impuestoIva: 0 }
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
    // AFIP valida ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx + ImpTotConc
    // y rechaza el comprobante si no cierra, así que el total se recalcula
    // desde las partes en vez de copiar `input.total`.
    ImpTotal: round2(neto + impuestoIva),
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
