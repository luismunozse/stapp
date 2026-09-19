import { describe, it, expect } from "vitest"
import { getLifecycleEmail } from "@/lib/emails/lifecycle-templates"

const DATA = { nombre: "Ana", organizacion: "Taller Romemaq", slug: "romemaq" }

describe("Mail de invitacion al debito automatico", () => {
  it("dice que medios de pago sirven", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)

    expect(html).toMatch(/cr[ée]dito/i)
    expect(html).toMatch(/d[ée]bito/i)
    expect(html).toMatch(/dinero en cuenta/i)
  })

  it("avisa que la prepaga no sirve: son 7 de 13 pagadores", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).toMatch(/prepaga/i)
  })

  it("lleva a la pantalla de facturacion, no a una autorizacion suelta", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).toContain("/configuracion/billing")
  })

  it("dice que se puede cancelar cuando quiera", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).toMatch(/cancel/i)
  })

  it("NO promete que el precio queda fijo", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).not.toMatch(/precio.{0,30}(fijo|congelado)|congelamos/i)
  })

  it("tiene asunto", () => {
    const { subject } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(subject.length).toBeGreaterThan(10)
  })
})
