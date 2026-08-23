// @vitest-environment node
import { describe, it, expect } from "vitest"
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer"
import {
  LEYENDA_NO_FISCAL,
  leyendaPie,
  Seccion,
  FilaDetalle,
  BarraTotal,
  Badge,
  presupuestoZonaIzquierda,
  Cabecera,
  BandaCliente,
} from "@/lib/pdf-react-shell"
import { helveticaMetrics } from "@/lib/pdf-react-shared"
import { extractReactPdfText, extractReactPdfTextPositions } from "./pdf-text-helper-react"

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

describe("left-zone truncation budget", () => {
  it("is tighter with a letter box than without, because the legend sits further left", async () => {
    const metrics = await helveticaMetrics()
    const conCaja = presupuestoZonaIzquierda({ logo: false, letterBox: true, metrics })
    const sinCaja = presupuestoZonaIzquierda({ logo: false, letterBox: false, metrics })
    expect(conCaja).toBeLessThan(sinCaja)
  })

  it("shrinks by the logo box and its gap when a logo is present", async () => {
    const metrics = await helveticaMetrics()
    const conLogo = presupuestoZonaIzquierda({ logo: true, letterBox: true, metrics })
    const sinLogo = presupuestoZonaIzquierda({ logo: false, letterBox: true, metrics })
    expect(sinLogo - conLogo).toBe(95) // LOGO_BOX_WIDTH 80 + LOGO_GAP 15
  })

  it("gives the company-name row the letter-box budget, never the tighter legend one", async () => {
    // The name's row sits above the legend's, so only the box constrains it.
    // Collapsing both rows onto one budget silently truncates company names
    // between the two boundaries (~170pt and ~220pt) on a live remito.
    const metrics = await helveticaMetrics()
    const nombre = presupuestoZonaIzquierda({ logo: false, letterBox: true, metrics, fila: "nombre" })
    const datos = presupuestoZonaIzquierda({ logo: false, letterBox: true, metrics, fila: "datos" })
    expect(nombre).toBeGreaterThan(datos)
    expect(metrics.bold.widthOfTextAtSize("Reparaciones El Sol Servicios Integrales", 9)).toBeGreaterThan(datos)
    expect(metrics.bold.widthOfTextAtSize("Reparaciones El Sol Servicios Integrales", 9)).toBeLessThan(nombre)
  })

  it("uses one budget for every row when there is no letter box to clear", async () => {
    const metrics = await helveticaMetrics()
    const nombre = presupuestoZonaIzquierda({ logo: false, letterBox: false, metrics, fila: "nombre" })
    const datos = presupuestoZonaIzquierda({ logo: false, letterBox: false, metrics, fila: "datos" })
    expect(nombre).toBe(datos)
  })
})

describe("Cabecera", () => {
  it("renders the letter box and the legend only when asked", async () => {
    const metrics = await helveticaMetrics()
    const emisor = { nombreEmpresa: "Empresa Shell" }

    const conCaja = await extractReactPdfText(
      await render(
        <Cabecera emisor={emisor} metrics={metrics} titulo="REMITO" numero="0001-0001" letterBox="X" />
      )
    )
    expect(conCaja).toContain("X")
    expect(conCaja).toContain(LEYENDA_NO_FISCAL)

    const sinCaja = await extractReactPdfText(
      await render(<Cabecera emisor={emisor} metrics={metrics} titulo="RECIBO" numero="REC-00001" />)
    )
    expect(sinCaja).toContain("RECIBO")
    expect(sinCaja).not.toContain(LEYENDA_NO_FISCAL)
  })

  it("keeps the number's row when the document declares one, blank or not", async () => {
    // A document that always prints a number (the remito) must not shift up
    // when that number comes back empty — the row still costs its 2pt margin.
    // Only a document with no number line at all (the resumen) drops it.
    const metrics = await helveticaMetrics()
    const emisor = { nombreEmpresa: "Empresa Shell" }
    const bajoElNumero = async (numero?: string) =>
      (
        await extractReactPdfTextPositions(
          await render(
            <Cabecera
              emisor={emisor}
              metrics={metrics}
              titulo="REMITO"
              numero={numero}
              lineasDerecha={["Emisión: 17/08/2026"]}
            />
          )
        )
      ).find((i) => i.text.startsWith("Emisión"))!.y

    const sinLinea = await bajoElNumero(undefined)
    const vacio = await bajoElNumero("")
    const lleno = await bajoElNumero("0001-0001")
    expect(sinLinea - vacio).toBe(2) // the blank row's own marginTop
    expect(lleno).toBeLessThan(vacio) // a real number costs a full row
  })

  it("puts the document's own body inside the frame, after the header rule", async () => {
    const metrics = await helveticaMetrics()
    const text = await extractReactPdfText(
      await render(
        <Cabecera emisor={{ nombreEmpresa: "Empresa Shell" }} metrics={metrics} titulo="RECIBO">
          <Text>CUERPO PROPIO</Text>
        </Cabecera>
      )
    )
    expect(text).toContain("Empresa Shell")
    expect(text).toContain("CUERPO PROPIO")
  })
})

describe("BandaCliente", () => {
  it("prints the cliente and whatever the document puts on the right", async () => {
    const text = await extractReactPdfText(
      await render(
        <BandaCliente
          label="Recibimos de"
          cliente={{ nombre: "Juan Pérez", dni: "20123456" }}
          derecha={<Text>VENTA: V0020</Text>}
        />
      )
    )
    expect(text).toContain("RECIBIMOS DE")
    expect(text).toContain("Juan Pérez")
    expect(text).toContain("20123456")
    expect(text).toContain("VENTA: V0020")
  })

  it("prints only the fields the document asks for, in the order it asks for them", async () => {
    const cliente = { nombre: "Juan Pérez", dni: "20123456", telefono: "011-1", direccion: "Calle 1" }
    const conDni = await extractReactPdfText(await render(<BandaCliente label="Cliente" cliente={cliente} />))
    expect(conDni).toContain("DNI/CUIT: 20123456")

    const sinDni = await extractReactPdfText(
      await render(<BandaCliente label="Cliente" cliente={cliente} campos={["direccion", "telefono"]} />)
    )
    expect(sinDni).not.toContain("DNI/CUIT: 20123456")
    expect(sinDni.indexOf("Calle 1")).toBeLessThan(sinDni.indexOf("Tel: 011-1"))
  })
})
