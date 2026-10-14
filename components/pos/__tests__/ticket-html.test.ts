import { describe, it, expect } from "vitest"
import { buildTicketHTML } from "../ticket-html"

const base = {
  numeroVenta: 42,
  organizationName: "Taller Demo",
  clienteNombre: "Juan",
  items: [{ descripcion: "Funda", cantidad: 2, precioUnitario: 500 }],
  subtotal: 1000,
  descuento: 0,
  total: 1000,
}
const opts = { timezone: "America/Argentina/Buenos_Aires", printerWidth: 58 }

describe("buildTicketHTML", () => {
  it("escapa el nombre del cliente: un nombre cargado desde el catálogo público no puede inyectar HTML", () => {
    const html = buildTicketHTML(
      { ...base, clienteNombre: `<img src=x onerror="fetch('/api/x')">`, clienteTelefono: "<b>1</b>" },
      opts
    )
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img src=x onerror=&quot;fetch(&#39;/api/x&#39;)&quot;&gt;")
    expect(html).not.toContain("<b>1</b>")
  })

  it("escapa la descripción de los ítems y el nombre de la empresa", () => {
    const html = buildTicketHTML(
      {
        ...base,
        organizationName: "<script>alert(1)</script>",
        items: [{ descripcion: "</div><script>alert(2)</script>", cantidad: 1, precioUnitario: 10 }],
      },
      opts
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("&lt;/div&gt;&lt;script&gt;alert(2)&lt;/script&gt;")
  })

  it("imprime la fecha de la venta, no la de la reimpresión", () => {
    const html = buildTicketHTML(
      { ...base, createdAt: "2026-01-15T13:30:00.000Z" },
      { ...opts, now: new Date("2026-10-03T12:00:00Z") }
    )
    expect(html).toContain("15/01/2026")
    expect(html).not.toContain("03/10/2026")
  })

  it("con IVA aditivo agrega la línea de IVA para que subtotal + IVA cuadre con el total", () => {
    const html = buildTicketHTML(
      { ...base, ivaRegimen: "ADITIVO", ivaTasa: 21, ivaMonto: 210, total: 1210 },
      { ...opts, formatPrice: (n) => `$${n}` }
    )
    expect(html).toContain("IVA (21%):")
    expect(html).toContain("$210")
    expect(html).toContain("$1210")
  })

  it("con IVA incluido lo informa sin sumarlo, y muestra el redondeo con su signo", () => {
    const html = buildTicketHTML(
      { ...base, ivaRegimen: "INCLUIDO", ivaTasa: 21, ivaMonto: 173.55, redondeoMonto: -0.5, total: 999.5 },
      { ...opts, formatPrice: (n) => `$${n}` }
    )
    expect(html).toContain("IVA incluido (21%): $173.55")
    expect(html).toContain("Redondeo:")
    expect(html).toContain("-$0.5")
  })

  it("con logo binarizado lo dibuja arriba del nombre de la empresa", () => {
    const logo = "data:image/png;base64,iVBORw0KGgo="
    const html = buildTicketHTML(base, { ...opts, logoDataUrl: logo })
    expect(html).toContain(`<img src="${logo}"`)
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Taller Demo</div>"))
  })

  it("sin logo no dibuja ninguna imagen", () => {
    const html = buildTicketHTML(base, { ...opts, logoDataUrl: null })
    expect(html).not.toContain("<img")
  })

  it("una venta fiada muestra el saldo pendiente", () => {
    const html = buildTicketHTML(
      { numeroVenta: 3, total: 500, saldoPendiente: 500, items: [] },
      { timezone: "America/Argentina/Buenos_Aires", printerWidth: 58, formatPrice: (n) => `$${n}` }
    )
    expect(html).toContain("Saldo pendiente:")
    expect(html).toContain("$500")
  })
})
