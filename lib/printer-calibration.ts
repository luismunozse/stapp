// Tests físicos de calibración y máquina de pasos del wizard de impresora.
// Los tests se imprimen por WebUSB; el usuario elige qué salió bien y esa
// elección arma el PrinterProfile (ver spec 2026-08-03).

import { textToBytes, charsetCommand, cutCommands, generateOrdenTicketCommands } from "@/lib/escpos"
import type { Codepage, Corte, PrinterProfile } from "@/lib/thermal-paper"

const ESC = 0x1b
const LF = 0x0a
const INIT = [ESC, 0x40]
const FEED_3 = [ESC, 0x64, 0x03]
const FEED_5 = [ESC, 0x64, 0x05]

export const COLUMNAS_CANDIDATAS = [32, 42, 48] as const
export const CODEPAGE_CANDIDATAS: Codepage[] = ["cp437", "cp850", "cp858", "win1252"]

const line = (text: string): number[] => [...textToBytes(text), LF]

/** Regla de exactamente n caracteres: "123456789.123..." + "|" al final. */
function regla(n: number): string {
  let s = ""
  while (s.length < n - 1) s += "123456789."
  return s.slice(0, n - 1) + "|"
}

export function generateColumnsTest(): Uint8Array {
  const buf: number[] = [...INIT]
  buf.push(...line("TEST DE COLUMNAS"))
  COLUMNAS_CANDIDATAS.forEach((n, i) => {
    buf.push(...line(`${i + 1}) ${n} columnas:`))
    buf.push(...line(regla(n)))
  })
  buf.push(...FEED_5)
  return new Uint8Array(buf)
}

export function generateCodepageTest(): Uint8Array {
  const buf: number[] = [...INIT]
  buf.push(...line("TEST DE ACENTOS"))
  CODEPAGE_CANDIDATAS.forEach((cp, i) => {
    // Cada línea se imprime tras seleccionar SU tabla: lo que el usuario elige
    // es el par (ESC t n, encoder) que su firmware realmente entiende.
    buf.push(...charsetCommand(cp))
    buf.push(...textToBytes(`${i + 1}) áéíóúñÑ ¿¡°`, cp), LF)
  })
  buf.push(...charsetCommand("cp858")) // restaurar el default del motor
  buf.push(...FEED_5)
  return new Uint8Array(buf)
}

export function generateCutTest(): Uint8Array {
  const buf: number[] = [...INIT]
  buf.push(...line("CORTE 1"))
  buf.push(...FEED_3, ...cutCommands("gsv"))
  buf.push(...line("CORTE 2"))
  buf.push(...FEED_3, ...cutCommands("esci"))
  buf.push(...line("FIN DEL TEST"))
  buf.push(...FEED_5)
  return new Uint8Array(buf)
}

export function generateSampleTicket(profile: PrinterProfile): Uint8Array {
  return generateOrdenTicketCommands(
    {
      numeroOrden: 0,
      codigoOrden: "TEST-CALIBRACION",
      fechaIngreso: "Ticket de prueba",
      estado: "Calibración",
      cliente: { nombre: "Cliente de Prueba", telefono: "011-1234-5678" },
      dispositivo: "Impresora térmica",
      problemaReportado: "Si este ticket se lee bien de borde a borde y los acentos salen correctos (áéíóúñÑ ¿¡°), la calibración quedó lista.",
    },
    profile,
  )
}

export type WizardStep = "conexion" | "columnas" | "acentos" | "corte" | "final"

export type WizardAction =
  | { type: "conectado" }
  | { type: "columnas"; columnas: 32 | 42 | 48 }
  | { type: "codepage"; codepage: Codepage }
  | { type: "corte"; corte: Corte }
  | { type: "reiniciar" }
  | { type: "sync"; profile: PrinterProfile }

export interface WizardState {
  step: WizardStep
  profile: PrinterProfile
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "conectado":
      return { ...state, step: "columnas" }
    case "columnas": {
      const ancho = action.columnas === 32 ? 58 : 80
      return { step: "acentos", profile: { ...state.profile, ancho, columnas: action.columnas } }
    }
    case "codepage":
      return { step: "corte", profile: { ...state.profile, codepage: action.codepage } }
    case "corte":
      return { step: "final", profile: { ...state.profile, corte: action.corte } }
    case "reiniciar":
      return { ...state, step: "conexion" }
    case "sync":
      return { step: "conexion", profile: action.profile }
  }
}
