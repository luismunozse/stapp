// @vitest-environment node
/**
 * Customer report: "no puedo importar CSV, da error de formato o de números y una
 * cantidad de errores cada vez, no me especifica en cuál".
 *
 * Covers the preview contract: a CSV with an unquoted decimal comma does not abort
 * the whole file, every invalid row is listed with the SAME line number the user
 * sees in Excel/Sheets, and Argentine-formatted numbers are not silently corrupted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64")

async function preview(csv: string, entityType: "INVENTARIO" | "CLIENTES" = "INVENTARIO") {
  const { POST } = await import("@/app/api/import/preview/route")
  return parseResponse(
    await POST(
      createPostRequest({ file: b64(csv), mime: "text/csv", filename: "datos.csv", entityType }),
    ),
  )
}

describe("POST /api/import/preview — per-row errors", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("does not abort the file for an unquoted decimal comma; lists the row instead", async () => {
    const { status, body } = await preview(
      "nombre,stock,precioVenta\nFunda,3,1500,50\nVidrio,2,800",
    )

    expect(status).toBe(200)
    expect(body.totalRows).toBe(2)
    expect(body.invalidRows).toBe(1)
    expect(body.invalidDetails).toHaveLength(1)
    expect(body.invalidDetails[0].row).toBe(2)
    expect(body.invalidDetails[0].error).toContain("más columnas")
    expect(body.invalidDetails[0].error).toContain("punto y coma")
    expect(JSON.stringify(body)).not.toMatch(/Too many fields|Row 0/)
  })

  it("lists EVERY invalid row with its spreadsheet line number and the column", async () => {
    const { body } = await preview(
      [
        "nombre;stock;precioVenta",
        "Funda;3;1.500,50", // line 2 ok
        "Vidrio;2;1.5.0", // line 3 bad price
        "", // line 4 blank
        "Cable;x;100", // line 5 bad stock
        "Cargador;1;200", // line 6 ok
      ].join("\n"),
    )

    expect(body.invalidRows).toBe(2)
    expect(body.invalidDetails.map((d: { row: number }) => d.row)).toEqual([3, 5])
    expect(body.invalidDetails[0].column).toBe("precioVenta")
    expect(body.invalidDetails[0].error).toContain('"1.5.0"')
    expect(body.invalidDetails[1].column).toBe("stock")
  })

  it("numbers the preview rows like the spreadsheet (header = 1, first data row = 2)", async () => {
    const { body } = await preview("nombre;stock;precioVenta\nA;1;10\nB;2;20")
    expect(body.preview.map((p: { row: number }) => p.row)).toEqual([2, 3])
  })

  it("does not corrupt Argentine prices: 1.500 -> 1500 and 12.000 -> 12000", async () => {
    const { body } = await preview("nombre;stock;precioVenta\nFunda;3;1.500,50\nVidrio;2;12.000")
    expect(body.invalidRows).toBe(0)
    expect(body.preview[0].parsed.precioVenta).toBe(1500.5)
    expect(body.preview[1].parsed.precioVenta).toBe(12000)
  })

  it("caps the invalid list but reports the real total", async () => {
    const rows = Array.from({ length: 130 }, (_, i) => `Item ${i};1;abc`)
    const { body } = await preview(["nombre;stock;precioVenta", ...rows].join("\n"))
    expect(body.invalidRows).toBe(130)
    expect(body.invalidDetails).toHaveLength(100)
  })

  it("accepts CLIENTES with leading-zero phone and DNI", async () => {
    const { status, body } = await preview(
      "nombre,telefono,dni\nJuan,0111234567,00123456",
      "CLIENTES",
    )
    expect(status).toBe(200)
    expect(body.invalidRows).toBe(0)
    expect(body.preview[0].valid).toBe(true)
  })
})
