// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest"
import { generateReciboCCPDF } from "@/lib/cuenta-corriente-react-pdf"
import { EMISOR } from "@/app/api/public/pdf-smoke/route"

afterEach(() => {
  delete process.env.PDF_SMOKE
  vi.resetModules()
})

const FECHA = new Date("2026-08-20T15:00:00Z")

describe("GET /api/public/pdf-smoke", () => {
  it("404s when the smoke flag is not set, so production never exposes it", async () => {
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it("renders every react-pdf document when the flag is set", async () => {
    process.env.PDF_SMOKE = "1"
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    // Every document must render to a real PDF, not an empty buffer.
    for (const [nombre, bytes] of Object.entries(body.documentos)) {
      expect(bytes, `${nombre} rendered nothing`).toBeGreaterThan(1000)
    }
    expect(Object.keys(body.documentos).sort()).toEqual(["reciboCC", "remito", "resumenCC"])
  })

  // Two halves, because one assertion can't carry both:
  //
  // Half A — the route's actual fixture (not a copy the test invents) really
  // carries a logo. Reads EMISOR straight from the route module, so deleting
  // `logoUrl` from route.ts's EMISOR fails this immediately.
  it("route's EMISOR fixture points at a real image, not an empty string", () => {
    expect(EMISOR.logoUrl).toMatch(/^data:image\/png;base64,/)
  })

  // Half B — that logo is not just present but actually changes the render.
  // fetchLogo() short-circuits to null when logoUrl is absent, and every
  // document gates <Image> behind that null check, so Half A alone would
  // keep passing even if <Image> silently stopped embedding it. Calling the
  // same generator with and without EMISOR's own logoUrl and comparing byte
  // counts is the only way to prove <Image> actually mounted.
  it("EMISOR's logo actually changes the rendered PDF, so <Image> can't silently no-op", async () => {
    const { logoUrl: _logoUrl, ...emisorSinLogo } = EMISOR
    const reciboFields = {
      numeroRecibo: "REC-00001",
      fecha: FECHA,
      tipo: "DEPOSITO",
      monto: 1000,
      saldoPosterior: 1000,
      metodoPago: "EFECTIVO",
      cliente: { nombre: "Cliente Smoke" },
    }

    const [conLogo, sinLogo] = await Promise.all([
      generateReciboCCPDF({ ...EMISOR, ...reciboFields }),
      generateReciboCCPDF({ ...emisorSinLogo, ...reciboFields }),
    ])

    // Margin, not just toBeGreaterThan: a couple of stray bytes could come
    // from something unrelated to image embedding. The 1x1 PNG plus its PDF
    // XObject overhead is worth several hundred bytes when it actually
    // mounts — see the fix report for the measured delta.
    expect(
      conLogo.length,
      "logo did not meaningfully change the rendered size — <Image> may not be mounting"
    ).toBeGreaterThan(sinLogo.length + 200)
  })
})
