import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { OgCard } from "@/lib/og/card"

/**
 * La tarjeta es visual y no se testea a ojo desde acá, pero si se pueden fijar
 * las decisiones que se toman a proposito y que es facil desarmar sin querer.
 */
describe("OgCard", () => {
  const html = (props?: Parameters<typeof OgCard>[0]) =>
    renderToStaticMarkup(<OgCard {...props} />)

  it("sin titulo muestra la tarjeta del producto", () => {
    const out = html()

    expect(out).toContain("Cada equipo,")
    expect(out).toContain("cada repuesto,")
    expect(out).toContain("cada peso.")
  })

  it("con titulo muestra el titulo y la bajada del articulo", () => {
    const out = html({ titulo: "Precio de una reparación", descripcion: "Guía práctica" })

    expect(out).toContain("Precio de una reparación")
    expect(out).toContain("Guía práctica")
    expect(out).not.toContain("Cada equipo,")
  })

  it("el chip de estado sale solo en la tarjeta del producto", () => {
    // "Listo para entregar" es un estado real de una orden. En un articulo del
    // blog no significa nada y confunde.
    expect(html()).toContain("Listo para entregar")
    expect(html({ titulo: "Una nota" })).not.toContain("Listo para entregar")
  })

  it("el articulo se identifica como tal", () => {
    expect(html({ titulo: "Una nota" })).toContain("BLOG")
    expect(html()).not.toContain("BLOG")
  })

  it("usa el isotipo real y no un cuadrado con letras", () => {
    // La version anterior dibujaba un div con el texto "ST". El isotipo real es
    // un equipo con un circuito en la pantalla, y es lo que hace reconocible a
    // la marca en un chat.
    const out = html()

    expect(out).toContain("<svg")
    expect(out).toContain("viewBox=\"0 0 48 48\"")
    expect(out).toContain("<circle")
  })

  it("no usa degrades", () => {
    // Las dos versiones anteriores se apoyaban en un degrade y terminaban
    // pareciendo cualquier banner de SaaS. Ademas el color plano aguanta mejor
    // el escalado a miniatura.
    expect(html()).not.toContain("gradient")
    expect(html({ titulo: "Una nota" })).not.toContain("gradient")
  })

  it("aguanta un titulo sin descripcion", () => {
    const out = html({ titulo: "Solo titulo" })

    expect(out).toContain("Solo titulo")
    expect(out).toContain("stapp.com.ar")
  })
})
