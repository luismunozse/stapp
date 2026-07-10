// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { fitPrintPageToContent } from "@/lib/print-fit-page"

function makeDocWithElement(offsetHeight: number | undefined): { doc: Document; el: HTMLElement | null } {
  const doc = document.implementation.createHTMLDocument("print")
  const el = doc.createElement("div")
  doc.body.appendChild(el)
  if (offsetHeight !== undefined) {
    Object.defineProperty(el, "offsetHeight", { value: offsetHeight, configurable: true })
  }
  return { doc, el }
}

describe("fitPrintPageToContent", () => {
  it("appends an @page style rule sized to the measured content as the last head child", () => {
    const { doc, el } = makeDocWithElement(500)

    fitPrintPageToContent(doc, el, 80)

    const styles = doc.head.querySelectorAll("style")
    expect(styles.length).toBe(1)
    const lastChild = doc.head.lastElementChild
    expect(lastChild).toBe(styles[styles.length - 1])
    expect(styles[0].textContent).toBe("@page { size: 80mm 135mm; margin: 0; }")
  })

  it("does nothing when offsetHeight is 0", () => {
    const { doc, el } = makeDocWithElement(0)

    fitPrintPageToContent(doc, el, 80)

    expect(doc.head.querySelectorAll("style").length).toBe(0)
  })

  it("does nothing and does not throw when el is null", () => {
    const { doc } = makeDocWithElement(500)

    expect(() => fitPrintPageToContent(doc, null, 80)).not.toThrow()
    expect(doc.head.querySelectorAll("style").length).toBe(0)
  })

  it("propagates a different width (58mm) into the generated rule", () => {
    const { doc, el } = makeDocWithElement(500)

    fitPrintPageToContent(doc, el, 58)

    const style = doc.head.querySelector("style")
    expect(style?.textContent).toBe("@page { size: 58mm 135mm; margin: 0; }")
  })
})
