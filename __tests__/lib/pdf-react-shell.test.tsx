// @vitest-environment node
import { describe, it, expect } from "vitest"
import { Document, Page, View, Text, renderToBuffer } from "@react-pdf/renderer"
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
  Firmas,
  Tabla,
  type ColumnaTabla,
} from "@/lib/pdf-react-shell"
import { helveticaMetrics } from "@/lib/pdf-react-shared"
import { extractReactPdfText, extractReactPdfTextPositions } from "./pdf-text-helper-react"
import { dumpGraphics } from "./pdf-golden-helper"

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

// The two documents' real header shapes, so the budget tests read as
// "the remito's" / "the recibo's" instead of a wall of flags.
const REMITO = { letterBox: true, zonaDerecha: "auto" } as const
const RECIBO = { letterBox: false, zonaDerecha: "fija" } as const

describe("left-zone truncation budget", () => {
  it("is tighter with a letter box than without, because the legend sits further left", async () => {
    const metrics = await helveticaMetrics()
    const conCaja = presupuestoZonaIzquierda({ logo: false, ...REMITO, metrics })
    const sinCaja = presupuestoZonaIzquierda({ logo: false, ...RECIBO, metrics })
    expect(conCaja).toBeLessThan(sinCaja)
  })

  it("shrinks by the logo box and its gap when a logo is present", async () => {
    const metrics = await helveticaMetrics()
    const conLogo = presupuestoZonaIzquierda({ logo: true, ...REMITO, metrics })
    const sinLogo = presupuestoZonaIzquierda({ logo: false, ...REMITO, metrics })
    expect(sinLogo - conLogo).toBe(95) // LOGO_BOX_WIDTH 80 + LOGO_GAP 15
  })

  it("gives the company-name row the letter-box budget, never the tighter legend one", async () => {
    // The name's row sits above the legend's, so only the box constrains it.
    // Collapsing both rows onto one budget silently truncates company names
    // between the two boundaries (~170pt and ~220pt) on a live remito.
    const metrics = await helveticaMetrics()
    const nombre = presupuestoZonaIzquierda({ logo: false, ...REMITO, metrics, fila: "nombre" })
    const datos = presupuestoZonaIzquierda({ logo: false, ...REMITO, metrics, fila: "datos" })
    expect(nombre).toBeGreaterThan(datos)
    expect(metrics.bold.widthOfTextAtSize("Reparaciones El Sol Servicios Integrales", 9)).toBeGreaterThan(datos)
    expect(metrics.bold.widthOfTextAtSize("Reparaciones El Sol Servicios Integrales", 9)).toBeLessThan(nombre)
  })

  it("uses one budget for every row when there is no letter box to clear", async () => {
    const metrics = await helveticaMetrics()
    const nombre = presupuestoZonaIzquierda({ logo: false, ...RECIBO, metrics, fila: "nombre" })
    const datos = presupuestoZonaIzquierda({ logo: false, ...RECIBO, metrics, fila: "datos" })
    expect(nombre).toBe(datos)
  })

  it("treats the right zone's sizing as its own axis, not a face of the letter box", async () => {
    // The two are independent inputs. A boxed header with a pinned right
    // zone is a combination that must already work, not a third style pair
    // for whichever document migrates next.
    const metrics = await helveticaMetrics()
    const sinCajaFija = presupuestoZonaIzquierda({ logo: false, letterBox: false, zonaDerecha: "fija", metrics })
    const sinCajaAuto = presupuestoZonaIzquierda({ logo: false, letterBox: false, zonaDerecha: "auto", metrics })
    expect(sinCajaFija).toBeLessThan(sinCajaAuto) // pinning eats the left zone's room

    // With a box drawn, the box is the tighter bound either way — which is
    // exactly why the axes must not be conflated: same budget, different
    // right-zone layout.
    const conCajaFija = presupuestoZonaIzquierda({ logo: false, letterBox: true, zonaDerecha: "fija", metrics })
    const conCajaAuto = presupuestoZonaIzquierda({ logo: false, letterBox: true, zonaDerecha: "auto", metrics })
    expect(conCajaFija).toBe(conCajaAuto)
  })
})

describe("Cabecera", () => {
  it("renders the letter box and the legend only when asked", async () => {
    const metrics = await helveticaMetrics()
    const emisor = { nombreEmpresa: "Empresa Shell" }

    const conCaja = await extractReactPdfText(
      await render(
        <Cabecera
          emisor={emisor}
          metrics={metrics}
          zonaDerecha="auto"
          titulo="REMITO"
          numero="0001-0001"
          letterBox="X"
        />
      )
    )
    expect(conCaja).toContain("X")
    expect(conCaja).toContain(LEYENDA_NO_FISCAL)

    const sinCaja = await extractReactPdfText(
      await render(
        <Cabecera emisor={emisor} metrics={metrics} zonaDerecha="fija" titulo="RECIBO" numero="REC-00001" />
      )
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
              zonaDerecha="auto"
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
        <Cabecera
          emisor={{ nombreEmpresa: "Empresa Shell" }}
          metrics={metrics}
          zonaDerecha="fija"
          titulo="RECIBO"
        >
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
          espacioDerecha={8}
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
    const conDni = await extractReactPdfText(
      await render(<BandaCliente label="Cliente" cliente={cliente} espacioDerecha={8} />)
    )
    expect(conDni).toContain("DNI/CUIT: 20123456")

    const sinDni = await extractReactPdfText(
      await render(
        <BandaCliente label="Cliente" cliente={cliente} espacioDerecha={8} campos={["direccion", "telefono"]} />
      )
    )
    expect(sinDni).not.toContain("DNI/CUIT: 20123456")
    expect(sinDni.indexOf("Calle 1")).toBeLessThan(sinDni.indexOf("Tel: 011-1"))
  })

  it("lets the gutter decide where an uncapped cliente name wraps", async () => {
    // `nombre` is not length-capped (only `direccion` is, and only by the
    // remito), so this column's width is load-bearing: it decides where a
    // long company name breaks. That is why espacioDerecha is required and
    // per-document rather than a house constant one document donates.
    //
    // Note it is `nombre` and not `email` that this pins: an address is a
    // single token with no break opportunity, so react-pdf overflows it
    // instead of wrapping. Only text with spaces re-flows.
    const nombre = "Distribuidora Mayorista del Litoral Argentino Sociedad Anónima"
    const metrics = await helveticaMetrics()
    // A column just wide enough for the name, so the gutter alone decides.
    const ancho = metrics.bold.widthOfTextAtSize(nombre, 9) + 20

    const lineas = async (espacioDerecha: number) =>
      (
        await extractReactPdfTextPositions(
          await render(
            <View style={{ width: ancho }}>
              <BandaCliente
                label="Cliente"
                cliente={{ nombre }}
                espacioDerecha={espacioDerecha}
                campos={[]}
              />
            </View>
          )
        )
      ).filter((i) => i.text !== "CLIENTE").length

    expect(await lineas(4)).toBe(1) // a hairline gutter keeps it on one line
    expect(await lineas(60)).toBeGreaterThan(1) // a wider one breaks it
  })
})

describe("Firmas", () => {
  it("draws one caption per field", async () => {
    const text = await extractReactPdfText(
      await render(<Firmas titulo="Conformidad" campos={["Firma", "Aclaración"]} espacioSuperior={18} espacioFilas={22} />)
    )
    expect(text).toContain("CONFORMIDAD")
    expect(text).toContain("Firma")
    expect(text).toContain("Aclaración")
  })

  it("supports the four-field entrega variant", async () => {
    const text = await extractReactPdfText(
      await render(
        <Firmas
          titulo="Firmas de conformidad"
          campos={["Cliente (quien recibe)", "Encargado (quien entrega)"]}
          espacioSuperior={10}
          espacioFilas={16}
        />
      )
    )
    expect(text).toContain("Cliente (quien recibe)")
    expect(text).toContain("Encargado (quien entrega)")
  })
})

const COLS: ColumnaTabla[] = [
  { key: "fecha", titulo: "FECHA", ancho: 58 },
  { key: "concepto", titulo: "CONCEPTO", flex: true },
  { key: "monto", titulo: "MONTO", ancho: 74, alinear: "right", bold: true },
]

const muchasFilas = Array.from({ length: 60 }, (_, i) => ({
  fecha: "01/08/2026",
  concepto: `Movimiento ${i}`,
  monto: "$ 100,00",
}))

describe("Tabla", () => {
  it("renders the header and every row", async () => {
    const text = await extractReactPdfText(
      await render(
        <Tabla
          columnas={COLS}
          filas={[{ fecha: "01/08/2026", concepto: "Depósito", monto: "$ 1.000,00" }]}
        />
      )
    )
    expect(text).toContain("FECHA")
    expect(text).toContain("CONCEPTO")
    expect(text).toContain("Depósito")
    expect(text).toContain("$ 1.000,00")
  })

  it("repeats the header on later pages when headerFijo is set", async () => {
    const buffer = await render(<Tabla columnas={COLS} filas={muchasFilas} headerFijo />)
    const items = await extractReactPdfTextPositions(buffer)
    const paginas = new Set(items.filter((i) => i.text === "CONCEPTO").map((i) => i.page))
    expect(paginas.has(1)).toBe(true)
    expect(paginas.has(2)).toBe(true)
  })

  it("does not repeat the header when headerFijo is not set", async () => {
    const buffer = await render(<Tabla columnas={COLS} filas={muchasFilas} />)
    const items = await extractReactPdfTextPositions(buffer)
    const paginas = new Set(items.filter((i) => i.text === "CONCEPTO").map((i) => i.page))
    expect(paginas).toEqual(new Set([1]))
  })

  it("renders a non-string cell as-is, so a row can stack a note under its value", async () => {
    // The remito's pagos rows and the resumen's movimientos both do this —
    // it is why `filas` takes React.ReactNode instead of plain strings.
    const text = await extractReactPdfText(
      await render(
        <Tabla
          columnas={COLS}
          filas={[
            {
              fecha: "01/08/2026",
              concepto: (
                <>
                  <Text>Pago de cuenta corriente</Text>
                  <Text>3 cuotas · 10% recargo</Text>
                </>
              ),
              monto: "$ 100,00",
            },
          ]}
        />
      )
    )
    expect(text).toContain("Pago de cuenta corriente")
    expect(text).toContain("3 cuotas · 10% recargo")
  })

  it("insets a left-aligned column by sangriaIzquierda, defaulting to 6", async () => {
    // The remito's CANT./DESCRIPCIÓN and pagos FECHA sit at 8, everything
    // else at 6. Collapsing the two onto one house value moved the remito's
    // header text 2pt left — invisible to every content assertion, caught by
    // the golden harness. This pins the axis so it cannot drift back.
    const columnas: ColumnaTabla[] = [
      { key: "a", titulo: "SEIS", ancho: 100 },
      { key: "b", titulo: "OCHO", ancho: 100, sangriaIzquierda: 8 },
    ]
    const items = await extractReactPdfTextPositions(
      await render(<Tabla columnas={columnas} filas={[{ a: "x", b: "y" }]} />)
    )
    const seis = items.find((i) => i.text === "SEIS")
    const ocho = items.find((i) => i.text === "OCHO")
    expect(seis).toBeDefined()
    expect(ocho).toBeDefined()
    // Column B starts 100pt after column A, then insets 2pt further.
    expect(Math.round((ocho!.x - seis!.x) * 100) / 100).toBe(102)
  })

  it("shades the header band only when headerSombreado is set", async () => {
    // MONO.totalBg (#f2f2f2) is a filled rect behind the header row; it draws
    // no text at all, so the only way to see it from a test is the content
    // stream. 0.95 == 242/255.
    const conFondo = await dumpGraphics(
      await render(<Tabla columnas={COLS} filas={[{ fecha: "a", concepto: "b", monto: "c" }]} headerSombreado />)
    )
    const sinFondo = await dumpGraphics(
      await render(<Tabla columnas={COLS} filas={[{ fecha: "a", concepto: "b", monto: "c" }]} />)
    )
    expect(conFondo.some((op) => op.includes("scn 0.95 0.95 0.95"))).toBe(true)
    expect(sinFondo.some((op) => op.includes("scn 0.95 0.95 0.95"))).toBe(false)
  })
})
