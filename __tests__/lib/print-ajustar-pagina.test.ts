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

  it("por defecto ajusta la página al alto del contenido", () => {
    const { doc, el } = docConContenido(378) // 100mm
    ajustarPaginaImpresion(doc, el, 80)
    expect(reglasPage(doc)).toEqual(["@page { size: 80mm 103mm; margin: 0; }"])
  })

  it("con 'Alinear arriba' deja el tamaño de hoja del driver", () => {
    saveAlinearArriba(true)
    const { doc, el } = docConContenido(378)
    ajustarPaginaImpresion(doc, el, 80)
    expect(reglasPage(doc)).toEqual(["@page { size: auto; margin: 0; }"])
  })

  it("la preferencia se guarda y se puede apagar", () => {
    expect(readAlinearArriba()).toBe(false)
    saveAlinearArriba(true)
    expect(readAlinearArriba()).toBe(true)
    saveAlinearArriba(false)
    expect(readAlinearArriba()).toBe(false)
  })
})
