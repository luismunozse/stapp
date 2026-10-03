import { describe, it, expect } from "vitest"
import {
  barcodeBoxMm,
  buildLabelsHtml,
  LABEL_SIZE_CONFIG,
  THERMAL_SIZES,
  type BuiltLabel,
} from "@/lib/labels/build-labels-html"

const lbl = (over: Partial<BuiltLabel> = {}): BuiltLabel => ({
  name: "Cable USB",
  barcodeSvg: "<svg></svg>",
  code: "ABC-1",
  price: "$ 10",
  ...over,
})

const count = (html: string, re: RegExp) => (html.match(re) || []).length
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html")

describe("buildLabelsHtml térmica die-cut", () => {
  const html = buildLabelsHtml([lbl(), lbl(), lbl()], { medium: "thermal", size: "50x30" })

  it("emite @page con el tamaño exacto y margen 0", () => {
    expect(html).toMatch(/@page\s*\{\s*size:\s*50mm 30mm;\s*margin:\s*0;/)
  })
  it("la etiqueta mide 0.3mm menos que la página para evitar una hoja en blanco", () => {
    expect(html).toMatch(/\.label\s*\{[^}]*width:\s*50mm;[^}]*height:\s*calc\(30mm - 0\.3mm\);/)
    expect(html).toMatch(/\.label\s*\{[^}]*overflow:\s*hidden;/)
  })
  it("N etiquetas producen N bloques", () => {
    expect(count(html, /<div class="label[ "]/g)).toBe(3)
  })
  it("salta de página tras cada etiqueta menos la última", () => {
    expect(html).toMatch(/\.label\s*\{[^}]*break-after:\s*page/)
    expect(html).toMatch(/\.label:last-child\s*\{[^}]*break-after:\s*auto/)
  })
  it("la última etiqueta es el último hijo de .sheet", () => {
    const doc = parse(html)
    const sheet = doc.querySelector(".sheet")!
    expect(sheet.children).toHaveLength(3)
    expect(Array.from(sheet.children).every((c) => c.classList.contains("label"))).toBe(true)
    expect(sheet.lastElementChild).toBe(doc.querySelectorAll(".sheet > .label")[2])
  })
  it("no usa el layout de planilla", () => {
    expect(html).not.toContain("margin: 5mm")
    expect(html).not.toContain("flex-wrap")
  })
})

describe("buildLabelsHtml térmica rollo", () => {
  it.each([
    ["58mm", 58, 30],
    ["80mm", 80, 40],
  ] as const)("%s emite un tamaño explícito Wmm Hmm", (size, w, h) => {
    const html = buildLabelsHtml([lbl()], { medium: "thermal", size })
    expect(html).toMatch(
      new RegExp(String.raw`@page\s*\{\s*size:\s*${w}mm ${h}mm;\s*margin:\s*0;`),
    )
    expect(html).toMatch(
      new RegExp(String.raw`\.label\s*\{[^}]*height:\s*calc\(${h}mm - 0\.3mm\);`),
    )
  })
  it("también salta de página entre etiquetas", () => {
    const html = buildLabelsHtml([lbl(), lbl()], { medium: "thermal", size: "58mm" })
    expect(count(html, /<div class="label[ "]/g)).toBe(2)
    expect(html).toMatch(/\.label:last-child\s*\{[^}]*break-after:\s*auto/)
  })
})

describe("ninguna salida térmica usa tamaño auto en @page", () => {
  it.each(THERMAL_SIZES)("%s", (size) => {
    const html = buildLabelsHtml([lbl()], { medium: "thermal", size })
    expect(html).not.toMatch(/@page\s*\{[^}]*size:\s*[^;]*auto/)
  })
})

describe("scripts", () => {
  it("la salida térmica no trae window.print ni <script", () => {
    const html = buildLabelsHtml([lbl()], { medium: "thermal", size: "50x30" })
    expect(html).not.toContain("window.print")
    expect(html).not.toContain("<script")
  })
  it("la hoja sí dispara window.print", () => {
    const html = buildLabelsHtml([lbl()], { medium: "sheet", size: "50x30" })
    expect(html).toContain("window.print")
    expect(html).toContain("<script")
  })
})

describe("buildLabelsHtml hoja (sheet)", () => {
  const html = buildLabelsHtml([lbl(), lbl()], { medium: "sheet", size: "50x30" })
  it("mantiene el layout anterior", () => {
    expect(html).toMatch(/@page\s*\{\s*size:\s*auto;\s*margin:\s*5mm;/)
    expect(html).toContain("flex-wrap: wrap")
    expect(html).toContain("gap: 2mm")
    expect(html).toMatch(/\.label\s*\{[^}]*width:\s*50mm;[^}]*height:\s*30mm;/)
  })
  it("no fuerza saltos de página por etiqueta", () => {
    expect(html).not.toContain("break-after: page")
  })
})

describe("contenido", () => {
  it("escapa nombre y código", () => {
    const html = buildLabelsHtml(
      [lbl({ name: `<img src=x onerror="a">&'`, code: "<b>1</b>" })],
      { medium: "thermal", size: "50x30" },
    )
    expect(html).not.toContain("<img src=x")
    expect(html).not.toContain("<b>1</b>")
    expect(html).toContain("&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;")
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;")
  })
  it("sin barcodeSvg es etiqueta de precio y no emite bloque de barras", () => {
    const html = buildLabelsHtml([lbl({ barcodeSvg: undefined, code: undefined })], {
      medium: "thermal",
      size: "50x30",
    })
    expect(html).toContain('class="label label--price"')
    expect(html).not.toContain('<div class="barcode">')
    expect(html).not.toContain('<div class="code">')
  })
  it("omite las partes ausentes", () => {
    const html = buildLabelsHtml([lbl({ name: undefined, price: undefined })], {
      medium: "sheet",
      size: "40x25",
    })
    expect(html).not.toContain('<div class="name">')
    expect(html).not.toContain('<div class="price">')
  })
})

describe("LABEL_SIZE_CONFIG", () => {
  it("define die-cut y rollos con alto fijo", () => {
    expect(LABEL_SIZE_CONFIG["40x25"]).toMatchObject({ mode: "label", widthMm: 40, heightMm: 25 })
    expect(LABEL_SIZE_CONFIG["58mm"]).toMatchObject({ mode: "roll", widthMm: 58, heightMm: 30 })
    expect(LABEL_SIZE_CONFIG["80mm"]).toMatchObject({ mode: "roll", widthMm: 80, heightMm: 40 })
  })
  it("el rótulo del rollo muestra el alto resultante", () => {
    expect(LABEL_SIZE_CONFIG["58mm"].label).toBe("Rollo 58 mm (etiquetas de 30 mm)")
    expect(LABEL_SIZE_CONFIG["80mm"].label).toBe("Rollo 80 mm (etiquetas de 40 mm)")
  })
})

describe("barcodeBoxMm", () => {
  it.each(THERMAL_SIZES)("%s: caja positiva y dentro de la etiqueta", (size) => {
    const box = barcodeBoxMm(size)
    const cfg = LABEL_SIZE_CONFIG[size]
    expect(box.widthMm).toBeGreaterThan(0)
    expect(box.heightMm).toBeGreaterThanOrEqual(6)
    expect(box.widthMm).toBeLessThan(cfg.widthMm)
    expect(box.heightMm).toBeLessThan(cfg.heightMm!)
  })
  it("el rollo de 58 mm tiene una caja ancha (aprovecha el ancho)", () => {
    const box = barcodeBoxMm("58mm")
    expect(box.widthMm).toBeGreaterThan(50)
  })
})
