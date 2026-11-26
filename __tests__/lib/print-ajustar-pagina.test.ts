import { describe, it, expect, beforeEach } from "vitest"
import { ajustarPaginaImpresion } from "@/lib/print-fit-page"
import { readAlinearArriba, saveAlinearArriba } from "@/lib/thermal-paper"

function docConContenido(altoPx: number) {
  const doc = document.implementation.createHTMLDocument("ticket")
  const el = doc.createElement("div")
  Object.defineProperty(el, "offsetHeight", { value: altoPx })
  doc.body.appendChild(el)
  return { doc, el }
}

function reglasPage(doc: Document) {
  return Array.from(doc.head.querySelectorAll("style")).map((s) => s.textContent)
}

describe("ajustarPaginaImpresion", () => {
  beforeEach(() => localStorage.clear())

  it("con 'Alinear arriba' desactivado ajusta la página al alto del contenido", () => {
    saveAlinearArriba(false)
    const { doc, el } = docConContenido(378) // 100mm
    ajustarPaginaImpresion(doc, el, 80)
    expect(reglasPage(doc)).toEqual(["@page { size: 80mm 103mm; margin: 0; }"])
  })

  it("por defecto ('Alinear arriba') deja el tamaño de hoja del driver", () => {
    const { doc, el } = docConContenido(378)
    ajustarPaginaImpresion(doc, el, 80)
    expect(reglasPage(doc)).toEqual(["@page { size: auto; margin: 0; }"])
  })

  it("la preferencia se guarda y se puede apagar", () => {
    expect(readAlinearArriba()).toBe(true)
    saveAlinearArriba(false)
    expect(readAlinearArriba()).toBe(false)
    saveAlinearArriba(true)
    expect(readAlinearArriba()).toBe(true)
  })
})

describe("anchoImprimibleMm", () => {
  it("usa el ancho del cabezal, no el del papel", async () => {
    const { anchoImprimibleMm } = await import("@/lib/thermal-paper")
    expect(anchoImprimibleMm(58)).toBe(48)
    expect(anchoImprimibleMm(80)).toBe(72)
  })
})
