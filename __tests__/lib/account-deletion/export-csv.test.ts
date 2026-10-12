// @vitest-environment node
import { describe, it, expect } from "vitest"
import { BOM, rowsToCsv } from "@/lib/account-deletion/export-csv"

const sinBom = (s: string) => (s.startsWith(BOM) ? s.slice(BOM.length) : s)

describe("rowsToCsv", () => {
  it("empieza con BOM (Excel abre UTF-8) y usa CRLF", () => {
    const csv = rowsToCsv([{ a: 1 }])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.startsWith(BOM)).toBe(true)
    expect(sinBom(csv)).toBe("a\r\n1\r\n")
  })

  it("conserva los importes negativos (notas de crédito y devoluciones)", () => {
    expect(sinBom(rowsToCsv([{ monto: -1500.5 }, { monto: 20 }]))).toBe("monto\r\n-1500.5\r\n20\r\n")
  })

  it("neutraliza fórmulas SOLO en strings", () => {
    const csv = sinBom(rowsToCsv([{ nombre: "=HYPERLINK(\"x\")" }, { nombre: "+5491155" }, { nombre: "@cmd" }, { nombre: "-x" }]))
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(csv).toContain("'+5491155")
    expect(csv).toContain("'@cmd")
    expect(csv).toContain("'-x")
  })

  it("neutraliza strings que empiezan con TAB o CR", () => {
    const csv = sinBom(rowsToCsv([{ a: "\tcmd" }, { a: "\rcmd" }]))
    expect(csv).toBe("a\r\n'\tcmd\r\n\"'\rcmd\"\r\n")
  })

  it("un string numérico negativo ('-15.50') se trata como string: se prefija; el número -15.5 no", () => {
    expect(sinBom(rowsToCsv([{ v: "-15.50" }]))).toBe("v\r\n'-15.50\r\n")
    expect(sinBom(rowsToCsv([{ v: -15.5 }]))).toBe("v\r\n-15.5\r\n")
  })

  it("no prefija strings normales ni vacíos", () => {
    expect(sinBom(rowsToCsv([{ a: "hola", b: "" }]))).toBe("a,b\r\nhola,\r\n")
  })

  it("escapa comillas, comas y saltos de línea", () => {
    expect(sinBom(rowsToCsv([{ n: 'a,"b"\nc' }]))).toBe('n\r\n"a,""b""\nc"\r\n')
  })

  it("une las columnas de todas las filas y deja vacío lo que falta", () => {
    expect(sinBom(rowsToCsv([{ a: 1 }, { b: 2 }]))).toBe("a,b\r\n1,\r\n,2\r\n")
  })

  it("null/undefined vacíos, booleanos y objetos serializados", () => {
    expect(sinBom(rowsToCsv([{ a: null, b: undefined, c: true, d: { x: 1 } }]))).toBe('a,b,c,d\r\n,,true,"{""x"":1}"\r\n')
  })

  it("arrays como JSON y Dates como ISO", () => {
    const d = new Date("2026-01-02T03:04:05.000Z")
    expect(sinBom(rowsToCsv([{ a: [1, 2], d }]))).toBe('a,d\r\n"[1,2]",2026-01-02T03:04:05.000Z\r\n')
  })

  it("una Date inválida queda vacía", () => {
    expect(sinBom(rowsToCsv([{ d: new Date("nope") }]))).toBe("d\r\n\r\n")
  })

  it("sin filas devuelve solo el BOM", () => {
    expect(rowsToCsv([])).toBe(BOM)
  })
})
