// @vitest-environment node
import { describe, it, expect } from "vitest"
import { Document, Page, renderToBuffer } from "@react-pdf/renderer"
import { LEYENDA_NO_FISCAL, leyendaPie, Seccion, FilaDetalle, BarraTotal, Badge } from "@/lib/pdf-react-shell"
import { extractReactPdfText } from "./pdf-text-helper-react"

const render = (children: React.ReactNode) =>
  renderToBuffer(
    <Document>
      <Page size="A4">{children}</Page>
    </Document>
  )

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

describe("structural pieces", () => {
  it("uppercases the section label and keeps its body", async () => {
    const text = await extractReactPdfText(
      await render(
        <Seccion titulo="Detalle del movimiento">
          <FilaDetalle label="Concepto" valor="Depósito" />
        </Seccion>
      )
    )
    expect(text).toContain("DETALLE DEL MOVIMIENTO")
    expect(text).toContain("Concepto")
    expect(text).toContain("Depósito")
  })

  it("renders the total bar and the badge", async () => {
    const text = await extractReactPdfText(
      await render(
        <>
          <BarraTotal label="SALDO A FAVOR" valor="$ 1.000,00" />
          <Badge texto="PAGADO" />
        </>
      )
    )
    expect(text).toContain("SALDO A FAVOR")
    expect(text).toContain("$ 1.000,00")
    expect(text).toContain("PAGADO")
  })
})
