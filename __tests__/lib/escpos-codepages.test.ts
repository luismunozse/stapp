// @vitest-environment node
import { describe, it, expect } from "vitest"
import { textToBytes, charsetCommand, cutCommands } from "@/lib/escpos"

describe("textToBytes por codepage", () => {
  it("default sigue siendo cp858 (compat con call sites viejos)", () => {
    expect(textToBytes("á€")).toEqual([0xa0, 0xd5])
  })

  it("cp850 = mismo mapa que cp858 pero sin € (cae a '?')", () => {
    expect(textToBytes("áéíóúñÑ", "cp850")).toEqual(textToBytes("áéíóúñÑ", "cp858"))
    expect(textToBytes("€", "cp850")).toEqual([0x3f])
  })

  it("cp437: minusculas acentuadas iguales a cp850; Á Í Ó Ú caen a la vocal sin acento", () => {
    expect(textToBytes("áéíóúñÑ¿¡°", "cp437")).toEqual(textToBytes("áéíóúñÑ¿¡°", "cp850"))
    expect(textToBytes("ÁÍÓÚ", "cp437")).toEqual([0x41, 0x49, 0x4f, 0x55]) // "AIOU"
    expect(textToBytes("É", "cp437")).toEqual([0x90]) // É si existe en 437
    expect(textToBytes("€", "cp437")).toEqual([0x45]) // "E"
  })

  it("win1252: code points Latin-1 directos y € en 0x80", () => {
    expect(textToBytes("áñÑ¿", "win1252")).toEqual([0xe1, 0xf1, 0xd1, 0xbf])
    expect(textToBytes("€", "win1252")).toEqual([0x80])
    expect(textToBytes("好", "win1252")).toEqual([0x3f])
  })
})

describe("charsetCommand — ESC t n por codepage (estandar Epson)", () => {
  it.each([
    ["cp437", 0], ["cp850", 2], ["cp858", 19], ["win1252", 16],
  ] as const)("%s → ESC t %d", (cp, n) => {
    expect(charsetCommand(cp)).toEqual([0x1b, 0x74, n])
  })
})

describe("cutCommands por variante", () => {
  it("gsv: corte parcial GS V 65 3 (comportamiento actual)", () => {
    expect(cutCommands("gsv")).toEqual([0x1d, 0x56, 0x41, 0x03])
  })
  it("esci: feed de despeje + corte legacy ESC i", () => {
    expect(cutCommands("esci")).toEqual([0x1b, 0x64, 0x03, 0x1b, 0x69])
  })
  it("none: solo feed largo, sin comando de corte", () => {
    expect(cutCommands("none")).toEqual([0x1b, 0x64, 0x05])
  })
})
