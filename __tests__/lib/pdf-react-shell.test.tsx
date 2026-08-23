// @vitest-environment node
import { describe, it, expect } from "vitest"
import { LEYENDA_NO_FISCAL, leyendaPie } from "@/lib/pdf-react-shell"

describe("legend", () => {
  it("states the non-fiscal legend once, for every document to reuse", () => {
    expect(LEYENDA_NO_FISCAL).toBe("Documento no válido como comprobante fiscal")
  })

  it("builds a footer legend naming the document", () => {
    expect(leyendaPie("Recibo interno de cuenta corriente")).toBe(
      "Recibo interno de cuenta corriente — no válido como comprobante fiscal."
    )
  })
})
