import type { CondicionFiscalEmisor } from "@/lib/facturacion/types"

/**
 * Explicaciones accionables para los rechazos de ARCA (WSFE / WSAA).
 *
 * ARCA responde con un código y un texto pensado para programadores
 * ("10005: NO AUTORIZADO A EMITIR COMPROBANTES - EL PUNTO DE VENTA ...").
 * El taller ve ese texto con un cliente esperando y no sabe qué hacer. Acá se
 * traduce cada rechazo conocido a qué revisar y dónde. El texto original de
 * ARCA se conserva siempre (soporte lo necesita); la ayuda se agrega al final.
 *
 * Se reconoce por código y, cuando el código varía según la versión del
 * servicio, también por el texto.
 */

export interface ErrorArca {
  code?: number | string | null
  msg?: string | null
}

/** Nombre del sistema con el que hay que crear el punto de venta en ARCA. */
export function nombreSistemaPuntoVenta(condicionFiscal: unknown): string {
  const monotributo = "“Factura Electronica - Monotributo - Web Service”"
  const inscripto = "“RECE para aplicativo y Web Service”"
  if (condicionFiscal === "MONOTRIBUTO") return monotributo
  if (condicionFiscal === "RESPONSABLE_INSCRIPTO") return inscripto
  return `${monotributo} (Monotributo) o ${inscripto} (Responsable Inscripto)`
}

function condicionLegible(c?: CondicionFiscalEmisor | null): string {
  if (c === "MONOTRIBUTO") return "Monotributo"
  if (c === "RESPONSABLE_INSCRIPTO") return "Responsable Inscripto"
  return "la condición fiscal configurada"
}

type Regla = {
  codes?: number[]
  texto?: RegExp
  ayuda: (condicion?: CondicionFiscalEmisor | null) => string
}

const REGLAS: Regla[] = [
  {
    // Punto de venta no habilitado para web service con la condición actual.
    // Caso típico: el taller pasó de Responsable Inscripto a Monotributo (o al
    // revés) y sigue usando el punto de venta creado para la condición vieja.
    codes: [10005, 11002],
    texto: /PUNTO DE VENTA.*(DADO DE ALTA|HABILITADO)|TIPO RECE/i,
    ayuda: (c) =>
      `El punto de venta cargado no sirve para facturar como ${condicionLegible(c)}. ` +
      `En ARCA → Administración de puntos de venta y domicilios, creá un punto de venta nuevo con el sistema ` +
      `${nombreSistemaPuntoVenta(c)} y cargá ese número en Configuración → Facturación. ` +
      `Si cambiaste de condición fiscal, el punto de venta anterior no sirve: el sistema de un punto de venta no se puede modificar. ` +
      `Verificá también que el cambio de condición ya esté vigente en ARCA.`,
  },
  {
    // WSAA: la relación (delegación) no existe o todavía no se tomó.
    codes: [600],
    texto: /lista de relaciones|no aparecio cuit/i,
    ayuda: () =>
      "ARCA no reconoce la delegación del taller a STApp. Revisá en ARCA → Administrador de Relaciones que la " +
      "delegación del servicio de factura electrónica esté hecha y aceptada. Si la acabás de hacer, puede tardar unos minutos.",
  },
  {
    codes: [10016],
    texto: /proximo a autorizar|fecha del comprobante/i,
    ayuda: () =>
      "El número o la fecha no siguen al último comprobante autorizado en ese punto de venta. Pasa si se facturó " +
      "con ese punto de venta desde otro sistema o desde Comprobantes en línea. Usá un punto de venta exclusivo para STApp.",
  },
  {
    texto: /condici[oó]n frente al iva del receptor|CondicionIVAReceptor/i,
    ayuda: () =>
      "Falta o no es válida la condición frente al IVA del cliente. Revisá la condición fiscal y el documento del cliente en su ficha.",
  },
  {
    codes: [10015, 10013],
    texto: /DocNro|DocTipo|documento del receptor/i,
    ayuda: () =>
      "El documento del cliente no es válido para este comprobante. Revisá el tipo y número de documento (CUIT/DNI) en la ficha del cliente.",
  },
  {
    codes: [10048],
    texto: /ImpTotal|importe total/i,
    ayuda: () =>
      "Los importes del comprobante no cierran (total, neto, IVA o tributos). Revisá descuentos y recargos de la venta y volvé a intentar.",
  },
  {
    codes: [500, 501, 502],
    texto: /error interno|base de datos|servicio no disponible|timeout|ETIMEDOUT|ECONNRESET/i,
    ayuda: () => "ARCA tuvo un problema de su lado. No es un error de tu configuración: esperá unos minutos y volvé a intentar.",
  },
  {
    texto: /certificado|certificate|firma.*(invalida|vencid)|expired/i,
    ayuda: () =>
      "Hay un problema con el certificado. Si usás certificado propio, revisá que no esté vencido y que corresponda al CUIT cargado.",
  },
]

function codigoNumerico(code: ErrorArca["code"]): number | undefined {
  if (code == null) return undefined
  const n = Number(code)
  return Number.isFinite(n) ? n : undefined
}

/** Ayuda para un rechazo de ARCA, o `null` si no lo reconocemos. */
export function ayudaErrorArca(error: ErrorArca, condicion?: CondicionFiscalEmisor | null): string | null {
  const code = codigoNumerico(error.code)
  const msg = error.msg ?? ""
  for (const r of REGLAS) {
    if ((code !== undefined && r.codes?.includes(code)) || (r.texto && msg && r.texto.test(msg))) {
      return r.ayuda(condicion)
    }
  }
  return null
}

/**
 * Lista de rechazos → texto para el usuario: el detalle de ARCA y, una sola
 * vez por regla, qué hacer.
 */
export function describirErroresArca(errores: ErrorArca[], condicion?: CondicionFiscalEmisor | null): string {
  const detalle = errores.map((e) => `${e.code ?? "?"}: ${e.msg ?? ""}`.trim()).join("; ")
  const ayudas = [...new Set(errores.map((e) => ayudaErrorArca(e, condicion)).filter(Boolean))]
  return ayudas.length ? `${detalle}. ${ayudas.join(" ")}` : detalle
}

/** Lo mismo para mensajes ya armados como "CODIGO: texto". */
export function ayudaDeMensajes(mensajes: string[], condicion?: CondicionFiscalEmisor | null): string | null {
  const ayudas = mensajes
    .map((m) => {
      const match = m.match(/^\s*(\d+)\s*:\s*([\s\S]*)$/)
      return ayudaErrorArca(match ? { code: match[1], msg: match[2] } : { msg: m }, condicion)
    })
    .filter((a): a is string => !!a)
  const unicas = [...new Set(ayudas)]
  return unicas.length ? unicas.join(" ") : null
}

/**
 * `true` si el tipo de emisión que ARCA informa para el punto de venta
 * (FEParamGetPtosVenta → EmisionTipo, p. ej. "CAE - Monotributo" o
 * "CAE - RECE") dice explícitamente que es de la otra condición fiscal. Si el
 * texto no lo dice, no se afirma nada: la emisión de prueba lo decide.
 */
export function sistemaPuntoVentaNoCorresponde(
  emisionTipo: unknown,
  condicion?: CondicionFiscalEmisor | null
): boolean {
  if (typeof emisionTipo !== "string" || !emisionTipo.trim()) return false
  const esMonotributo = /monotributo/i.test(emisionTipo)
  const esRece = /\bRECE\b/i.test(emisionTipo)
  if (condicion === "MONOTRIBUTO") return esRece && !esMonotributo
  if (condicion === "RESPONSABLE_INSCRIPTO") return esMonotributo
  return false
}

/** Mensaje del diagnóstico cuando el punto de venta es de la otra condición fiscal. */
export function mensajePuntoVentaOtraCondicion(
  numero: number,
  emisionTipo: string,
  condicion?: CondicionFiscalEmisor | null
): string {
  return (
    `El punto de venta ${numero} está dado de alta en ARCA como “${emisionTipo.trim()}”. ` +
    (ayudaErrorArca({ code: 10005 }, condicion) ?? "")
  ).trim()
}
