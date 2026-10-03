import { describe, it, expect } from "vitest"
import {
  buildLabelsHtml,
  LABEL_SIZE_CONFIG,
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

describe("buildLabelsHtml térmica die-cut", () => {
  const html = buildLabelsHtml([lbl(), lbl(), lbl()], { medium: "thermal", size: "50x30" })

  it("emite @page con el tamaño exacto y margen 0", () => {
    expect(html).toMatch(/@page\s*\{\s*size:\s*50mm 30mm;\s*margin:\s*0;/)
  })
  it("cada etiqueta mide exactamente el tamaño", () => {
    expect(html).toMatch(/\.label\s*\{[^}]*width:\s*50mm;[^}]*height:\s*30mm;/)
  })
  it("N etiquetas producen N bloques", () => {
    expect(count(html, /<div class="label[ "]/g)).toBe(3)
  })
  it("salta de página tras cada etiqueta menos la última", () => {
    expect(html).toMatch(/\.label\s*\{[^}]*break-after:\s*page/)
    expect(html).toMatch(/\.label:last-child\s*\{[^}]*break-after:\s*auto/)
  })
  it("no usa el layout de planilla", () => {
    expect(html).not.toContain("margin: 5mm")
    expect(html).not.toContain("flex-wrap")
  })
})

describe("buildLabelsHtml térmica rollo", () => {
  it.each([
    ["58mm", 58],
    ["80mm", 80],
  ] as const)("%s emite size: Wmm auto", (size, w) => {
    const html = buildLabelsHtml([lbl()], { medium: "thermal", size })
    expect(html).toMatch(new RegExp(String.raw`@page\s*\{\s*size:\s*${w}mm auto;\s*margin:\s*0;`))
    expect(html).not.toMatch(/\.label\s*\{[^}]*height:\s*\d+mm/)
  })
  it("también salta de página entre etiquetas", () => {
    const html = buildLabelsHtml([lbl(), lbl()], { medium: "thermal", size: "58mm" })
    expect(count(html, /<div class="label[ "]/g)).toBe(2)
    expect(html).toMatch(/\.label:last-child\s*\{[^}]*break-after:\s*auto/)
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
  it("define die-cut y rollos", () => {
    expect(LABEL_SIZE_CONFIG["40x25"]).toMatchObject({ mode: "label", widthMm: 40, heightMm: 25 })
    expect(LABEL_SIZE_CONFIG["58mm"]).toMatchObject({ mode: "roll", widthMm: 58 })
    expect(LABEL_SIZE_CONFIG["80mm"].heightMm).toBeUndefined()
  })
})
