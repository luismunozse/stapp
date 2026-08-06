// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateOrdenTicketCommands, type OrdenTicketData } from "@/lib/escpos"
import { defaultProfile, type PrinterProfile } from "@/lib/thermal-paper"

const baseData: OrdenTicketData = {
  numeroOrden: 1,
  fechaIngreso: "01/08/2026 10:00",
  estado: "Recibido",
  cliente: { nombre: "Juan Pérez" },
  dispositivo: "iPhone 12",
  problemaReportado: "No enciende",
}

function bytesOf(p: PrinterProfile): number[] {
  return Array.from(generateOrdenTicketCommands(baseData, p))
}

function containsSeq(haystack: number[], needle: number[]): boolean {
  return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b))
}

describe("generateOrdenTicketCommands segun perfil", () => {
  it("emite ESC t de la codepage del perfil", () => {
    expect(containsSeq(bytesOf({ ...defaultProfile(80), codepage: "win1252" }), [0x1b, 0x74, 16])).toBe(true)
    expect(containsSeq(bytesOf(defaultProfile(80)), [0x1b, 0x74, 19])).toBe(true)
  })

  it("codepage win1252: 'é' de Pérez sale como 0xE9, no como byte CP858", () => {
    expect(bytesOf({ ...defaultProfile(80), codepage: "win1252" })).toContain(0xe9)
  })

  it("corte esci emite ESC i y no GS V; corte none no emite ninguno", () => {
    const esci = bytesOf({ ...defaultProfile(80), corte: "esci" })
    expect(containsSeq(esci, [0x1b, 0x69])).toBe(true)
    expect(containsSeq(esci, [0x1d, 0x56, 0x41])).toBe(false)
    const none = bytesOf({ ...defaultProfile(80), corte: "none" })
    expect(containsSeq(none, [0x1d, 0x56, 0x41])).toBe(false)
    expect(containsSeq(none, [0x1b, 0x69])).toBe(false)
  })

  it("columnas 42: el separador '=' mide 42, no 48", () => {
    const sep42 = Array(42).fill(0x3d) // "=" x42
    const bytes = bytesOf({ ...defaultProfile(80), columnas: 42 })
    expect(containsSeq(bytes, [...sep42, 0x0a])).toBe(true)
    expect(containsSeq(bytes, Array(48).fill(0x3d))).toBe(false)
  })
})
