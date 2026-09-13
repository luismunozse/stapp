import { z } from "zod"

export const VEREDICTOS = ["REPARABLE", "IRREPARABLE", "SIN_FALLA"] as const
export type Veredicto = (typeof VEREDICTOS)[number]

export const CAUSAS_DANO = [
  "CAIDA",
  "LIQUIDO",
  "SOBRETENSION",
  "DESGASTE",
  "USO_INDEBIDO",
  "FALLA_FABRICA",
  "DESCONOCIDA",
] as const
export type CausaDano = (typeof CAUSAS_DANO)[number]

export const veredictoSchema = z.enum(VEREDICTOS)
export const causaDanoSchema = z.enum(CAUSAS_DANO)

/**
 * Etiquetas en castellano para el dictamen del informe tecnico. Fuente unica:
 * antes vivian duplicadas en lib/pdf.ts, cotizacion-form.tsx y
 * cotizacion-publica.tsx, con el riesgo de que el taller vea un texto en
 * pantalla y el asegurador reciba otro en el PDF sobre el mismo equipo. El
 * tipado por `Veredicto`/`CausaDano` hace que agregar un valor a VEREDICTOS o
 * CAUSAS_DANO sin sumarle etiqueta sea un error de compilacion, no un
 * documento mudo en produccion.
 */
export const VEREDICTO_LABELS: Record<Veredicto, string> = {
  REPARABLE: "Reparable",
  IRREPARABLE: "Irreparable",
  SIN_FALLA: "Sin falla detectada",
}
export const CAUSA_DANO_LABELS: Record<CausaDano, string> = {
  CAIDA: "Caída",
  LIQUIDO: "Contacto con líquido",
  SOBRETENSION: "Sobretensión eléctrica",
  DESGASTE: "Desgaste por uso",
  USO_INDEBIDO: "Uso indebido",
  FALLA_FABRICA: "Falla de fábrica",
  DESCONOCIDA: "Desconocida",
}

/** Los dos veredictos que hacen que no haya nada que presupuestar. */
const SIN_PRESUPUESTO: readonly string[] = ["IRREPARABLE", "SIN_FALLA"]

export interface DatosInforme {
  cantidadItems: number
  veredicto?: string | null
  diagnosticoTecnico?: string | null
  causaDano?: string | null
}

/**
 * Un documento es un informe tecnico cuando no tiene items y el tecnico
 * dictamino que no hay reparacion que presupuestar. No hay flag ni tipo: el
 * informe es la consecuencia del veredicto.
 */
export function esInforme(datos: DatosInforme): boolean {
  return datos.cantidadItems === 0 && !!datos.veredicto && SIN_PRESUPUESTO.includes(datos.veredicto)
}

/**
 * Devuelve el mensaje a mostrarle al taller, o null si el documento es valido.
 *
 * Es una funcion pura y no un refine de Zod porque el PUT valida DESPUES de
 * fusionar el payload con la fila existente: un pedido puede cambiar el
 * veredicto sin mandar `items`, y el refine solo ve el payload.
 *
 * Las rutas devuelven unicamente error.errors[0].message, asi que estos textos
 * son literalmente lo que lee el usuario. Van redactados como instruccion.
 */
export function validarInforme(datos: DatosInforme): string | null {
  if (datos.cantidadItems > 0) return null

  if (!datos.veredicto) {
    return "Una cotización sin ítems necesita un veredicto técnico: elegí Irreparable o Sin falla detectada para emitirla como informe."
  }

  if (!SIN_PRESUPUESTO.includes(datos.veredicto)) {
    return "Si el equipo es reparable, el presupuesto necesita al menos un ítem."
  }

  if (!datos.diagnosticoTecnico || !datos.diagnosticoTecnico.trim()) {
    return "El informe técnico necesita el diagnóstico del técnico."
  }

  if (!datos.causaDano) {
    return "El informe técnico necesita la causa probable del daño."
  }

  return null
}
