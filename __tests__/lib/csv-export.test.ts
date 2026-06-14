import { describe, it, expect, vi } from "vitest"
import ExcelJS from "exceljs"
import { arrayToXLSX, type CSVColumn } from "@/lib/csv-export"

const COLUMNS: CSVColumn<any>[] = [
  { key: "nombre", header: "Nombre" },
  { key: "cliente.telefono", header: "Teléfono" },
  { key: "total", header: "Total", transform: (v) => Number(v).toFixed(2) },
]

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb.worksheets[0]
}

describe("arrayToXLSX", () => {
  it("writes a header row from the column headers", async () => {
    const ws = await loadWorkbook(await arrayToXLSX([], COLUMNS))
    expect(ws.getRow(1).getCell(1).value).toBe("Nombre")
    expect(ws.getRow(1).getCell(2).value).toBe("Teléfono")
    expect(ws.getRow(1).getCell(3).value).toBe("Total")
  })

  it("resolves dot-path keys and applies transforms", async () => {
    const rows = [{ nombre: "Juan", cliente: { telefono: "123" }, total: 99.5 }]
    const ws = await loadWorkbook(await arrayToXLSX(rows, COLUMNS))
    expect(ws.getRow(2).getCell(1).value).toBe("Juan")
    expect(ws.getRow(2).getCell(2).value).toBe("123")
    expect(ws.getRow(2).getCell(3).value).toBe("99.50")
  })

  it("returns headers-only when data is empty (no data rows)", async () => {
    const ws = await loadWorkbook(await arrayToXLSX([], COLUMNS))
    expect(ws.rowCount).toBe(1)
  })
})

import { triggerDownload } from "@/lib/csv-export"

describe("triggerDownload (web)", () => {
  it("creates an anchor with the download filename and clicks it", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock")
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const clicked: string[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement
      if (tag === "a") el.click = () => clicked.push(el.getAttribute("download") || "")
      return el
    })

    const blob = new Blob(["x"], { type: "text/plain" })
    await triggerDownload(blob, "report.xlsx")

    expect(createUrl).toHaveBeenCalled()
    expect(clicked).toContain("report.xlsx")
    expect(revokeUrl).toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})
