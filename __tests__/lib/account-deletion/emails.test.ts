// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/email/index", () => ({ sendPlatform: vi.fn().mockResolvedValue({ id: "m1", proveedor: "envialosimple" }) }))
import { sendPlatform } from "@/lib/email/index"
import {
  escapeHtml, buildUserDeletedEmail, buildOrgDeletedEmail, notifyAdminsUserDeleted, notifyAdminsOrgDeleted,
} from "@/lib/account-deletion/emails"
import { CONTACT_EMAIL } from "@/lib/contact"
import { GRACE_DAYS } from "@/lib/account-deletion/state"

describe("builders", () => {
  it("escapeHtml neutraliza markup", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;")
  })

  it("el aviso de baja de usuario escapa el nombre (viene de un campo libre)", () => {
    const { subject, html } = buildUserDeletedEmail({ nombre: "<script>x</script>", email: "a@b.com", rol: "TECNICO" })
    expect(subject).toMatch(/baja/i)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("el aviso de baja del taller trae la fecha de borrado definitivo, el solicitante y el contacto de soporte", () => {
    const { html } = buildOrgDeletedEmail({
      orgNombre: "Taller Uno", solicitante: "dueno@taller.com", borradoDefinitivo: new Date("2026-11-04T12:00:00Z"),
    })
    expect(html).toMatch(/noviembre/)
    expect(html).toContain("2026")
    expect(html).toContain("dueno@taller.com")
    expect(html).toContain(CONTACT_EMAIL)
    expect(html).toContain("soporte@stapp.com.ar")
  })

  it("P17: los subjects no admiten CR/LF ni caracteres de control (inyeccion de headers)", () => {
    const u = buildUserDeletedEmail({ nombre: "Pepe\r\nBcc: x@evil.com\u0000\u0007", email: "a@b.com", rol: "TECNICO" })
    expect(u.subject).not.toMatch(/[\u0000-\u001f\u007f]/)
    expect(u.subject).toContain("Pepe")
    const o = buildOrgDeletedEmail({ orgNombre: "Taller\nBcc: x@evil.com", solicitante: "a", borradoDefinitivo: new Date() })
    expect(o.subject).not.toMatch(/[\u0000-\u001f\u007f]/)
    expect(o.subject).toContain("Taller")
  })

  it("P17: el HTML del taller escapa nombre y solicitante", () => {
    const { html } = buildOrgDeletedEmail({ orgNombre: "<img src=x>", solicitante: "<b>&</b>", borradoDefinitivo: new Date() })
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<b>&</b>")
    expect(html).toContain("&lt;img src=x&gt;")
  })

  it("el plazo de anonimizacion sale de GRACE_DAYS", () => {
    const { html } = buildUserDeletedEmail({ nombre: "P", email: "a@b.com", rol: "TECNICO" })
    expect(html).toContain(`${GRACE_DAYS} días`)
  })
})

describe("notify*", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("avisa a cada ADMIN activo y no al propio usuario dado de baja", async () => {
    const users = createChainMock([{ email: "a@t.com" }, { email: "b@t.com" }], null)
    mockSupabaseFrom({ users })
    await notifyAdminsUserDeleted({ organizationId: "o1", userId: "u9", nombre: "Pepe", email: "pepe@t.com", rol: "ADMIN" })
    expect(users.neq).toHaveBeenCalledWith("id", "u9")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
    expect(vi.mocked(sendPlatform).mock.calls.map((c) => c[0].to)).toEqual(["a@t.com", "b@t.com"])
  })

  it("el aviso del taller va a todos los ADMIN, incluido quien lo pidió", async () => {
    const users = createChainMock([{ email: "a@t.com" }], null)
    mockSupabaseFrom({ users })
    await notifyAdminsOrgDeleted({ organizationId: "o1", orgNombre: "T", solicitante: "a@t.com", borradoDefinitivo: new Date() })
    expect(users.neq).not.toHaveBeenCalled()
    expect(sendPlatform).toHaveBeenCalledTimes(1)
  })

  it("no tira si falla el envío ni si falla la consulta de ADMIN", async () => {
    mockSupabaseFrom({ users: createChainMock([{ email: "a@t.com" }], null) })
    vi.mocked(sendPlatform).mockRejectedValueOnce(new Error("smtp"))
    await expect(
      notifyAdminsUserDeleted({ organizationId: "o1", userId: "u9", nombre: "P", email: "p@t.com", rol: "TECNICO" })
    ).resolves.toBeUndefined()

    mockSupabaseFrom({ users: createChainMock(null, { message: "down" }) })
    await expect(
      notifyAdminsOrgDeleted({ organizationId: "o1", orgNombre: "T", solicitante: "a", borradoDefinitivo: new Date() })
    ).resolves.toBeUndefined()
  })
})
