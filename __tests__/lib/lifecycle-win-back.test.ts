import { describe, it, expect } from "vitest"
import { getLifecycleEmail } from "@/lib/emails/lifecycle-templates"
import { CONTACT_EMAIL } from "@/lib/contact"

// The lifecycle cron fires WIN_BACK from the date of the org's LAST ORDER
// (app/api/cron/lifecycle-emails/route.ts), not from its last login. An org
// that sells through the POS every day without creating orders still gets it,
// so the copy must talk about orders and never claim the user stopped coming.
const data = { nombre: "Ana", organizacion: "Taller Norte", slug: "taller-norte" }

describe.each(["WIN_BACK_7", "WIN_BACK_30"] as const)("%s copy", (type) => {
  const { subject, html } = getLifecycleEmail(type, data)
  const text = `${subject}\n${html}`

  it("talks about orders, not about logging in", () => {
    expect(text).toMatch(/órdenes?/i)
    expect(text).not.toMatch(/no entrás|no te vemos|te extrañamos/i)
  })

  it("names the organization", () => {
    expect(html).toContain("Taller Norte")
  })

  it("points to the real support mailbox instead of asking for a reply", () => {
    expect(html).toContain(CONTACT_EMAIL)
    expect(text).not.toMatch(/respondé a este correo/i)
  })

  it("does not promise news it does not show", () => {
    expect(text).not.toMatch(/novedades/i)
  })

  it("says it is sent once instead of telling the user to ignore it", () => {
    expect(html).toMatch(/una sola vez/i)
    expect(text).not.toMatch(/ignoralo/i)
  })
})
