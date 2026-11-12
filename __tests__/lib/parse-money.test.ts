import { describe, it, expect } from "vitest"
import { parseMonto, parseMoneyInput, formatMontoInput } from "@/lib/parse-money"

describe("parseMonto — el único parser de montos", () => {
  it.each([
    // Convención argentina: punto de miles, coma decimal
    ["1.234,56", 1234.56],
    ["1.500,50", 1500.5],
    ["1.234.567,89", 1234567.89],
    ["1500,50", 1500.5],
    ["1,5", 1.5],
    ["0,5", 0.5],
    // Un punto seguido de exactamente 3 dígitos es de miles (así escribe un cajero)
    ["1.234", 1234],
    ["1.500", 1500],
    ["12.000", 12000],
    ["1.234.567", 1234567],
    ["12.345.678", 12345678],
    // En cualquier otro caso el punto es decimal (teclado de escritorio)
    ["1234.56", 1234.56],
    ["1500.50", 1500.5],
    ["1500.5", 1500.5],
    ["1.5", 1.5],
    ["1.50", 1.5],
    ["1.5000", 1.5],
    ["12.5", 12.5],
    ["1234.567", 1234.567],
    ["0.500", 0.5], // ceros adelante: no es "quinientos"
    // Una coma sola es SIEMPRE decimal
    ["1,234", 1.234],
    ["12,500", 12.5],
    // Estilo en-US con los dos separadores: el último es el decimal
    ["1,234.56", 1234.56],
    ["1,234,567.89", 1234567.89],
    ["1,234,567", 1234567],
    // Enteros y signo
    ["1500", 1500],
    ["0", 0],
    ["-5", -5],
    ["-2.000", -2000],
    ["-1.500,50", -1500.5],
    // Pegado desde otro lado: moneda, espacios
    ["$ 1.234,56", 1234.56],
    ["$1.500,50", 1500.5],
    ["$ 1.500", 1500],
    ["  1.234,5  ", 1234.5],
    ["1 500", 1500],
    ["1 500 000", 1500000],
    ["ARS 1.500", 1500],
    ["1.500 ARS", 1500],
    ["USD 15,50", 15.5],
    ["U$S 15", 15],
    // Estados intermedios mientras se tipea
    ["1.", 1],
    ["1,", 1],
    ["1.234,", 1234],
    [",5", 0.5],
    // Números nativos pasan tal cual
    [1500, 1500],
    [12.5, 12.5],
    [0, 0],
  ])("%j → %j", (input, expected) => {
    expect(parseMonto(input as string | number)).toBe(expected)
  })

  it.each([
    [""],
    ["   "],
    ["-"],
    ["$"],
    ["."],
    [","],
    ["abc"],
    ["12abc"],
    ["12abc34"],
    ["1e5"],
    ["--5"],
    ["1.5.0"],
    ["1,5,0"],
    ["1.50.000"],
    ["1.2,3.4"],
    ["1,500.50.20"],
    ["10 USD 20"],
    ["5 ars 100"],
    ["1usd5"],
    ["12 34"],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])("rechaza %j", (input) => {
    expect(parseMonto(input as string | number)).toBeNull()
  })

  it("null y undefined son null", () => {
    expect(parseMonto(null)).toBeNull()
    expect(parseMonto(undefined)).toBeNull()
  })

  it("no pierde plata como parseFloat", () => {
    // parseFloat("1500,50") = 1500 y parseFloat("1.500,50") = 1.5
    expect(parseMonto("1500,50")).not.toBe(1500)
    expect(parseMonto("1.500,50")).not.toBe(1.5)
  })
})

describe("parseMoneyInput — compatibilidad (NaN en vez de null)", () => {
  it("delega en parseMonto", () => {
    expect(parseMoneyInput("1.234,56")).toBe(1234.56)
    expect(parseMoneyInput(1500.5)).toBe(1500.5)
  })

  it("devuelve NaN para vacío o inválido", () => {
    expect(parseMoneyInput("")).toBeNaN()
    expect(parseMoneyInput("-")).toBeNaN()
    expect(parseMoneyInput("abc")).toBeNaN()
    expect(parseMoneyInput(null)).toBeNaN()
    expect(parseMoneyInput(undefined)).toBeNaN()
    expect(parseMoneyInput(NaN)).toBeNaN()
  })
})

describe("formatMontoInput", () => {
  it.each([
    [1234.56, "1.234,56"],
    [1500, "1.500"],
    [0.5, "0,5"],
    [0, "0"],
    [-1234567.89, "-1.234.567,89"],
  ])("%j → %j", (n, texto) => {
    expect(formatMontoInput(n)).toBe(texto)
  })

  it("vacío para null, undefined y no finitos", () => {
    expect(formatMontoInput(null)).toBe("")
    expect(formatMontoInput(undefined)).toBe("")
    expect(formatMontoInput(NaN)).toBe("")
  })

  it("vuelve a parsear al mismo número", () => {
    for (const n of [0, 0.01, 0.5, 1, 12.34, 999, 1000, 1234.5, 99999.99, 1234567.89, -42.1]) {
      expect(parseMonto(formatMontoInput(n))).toBe(n)
    }
  })
})
