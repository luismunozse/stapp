import { describe, it, expect } from "vitest"
import { AuthRepository } from "@arcasdk/core"

import { toLoginCredentials, wsaaLogin } from "@/lib/facturacion/arca/wsaa-login"

/**
 * El ticket WSAA vive en `wsaa_tickets` (migración 298) y se renueva con el
 * lease de `renewWsaaTicket`. Para que `@arcasdk/core` USE ese ticket en vez
 * de pedir uno propio, hay que inyectarlo como `credentials` +
 * `handleTicket: true`: en ese modo `AuthRepository.login()` devuelve el
 * ticket sin tocar la red (ver auth.repository.ts, rama `manualCredentials`).
 *
 * Sin esto cada cold start de Vercel dispara un login WSAA y AFIP responde
 * `coe.alreadyAuthenticated`, dejando a la org sin facturar hasta 12 h.
 */
describe("toLoginCredentials", () => {
  const ticket = {
    token: "TOKEN-DE-AFIP",
    sign: "SIGN-DE-AFIP",
    expiresAt: "2026-08-30T11:35:00.000Z",
    generatedAt: "2026-08-29T23:35:00.000Z",
  }

  it("produce credenciales que el SDK acepta sin llamar a WSAA", async () => {
    const repo = new AuthRepository({
      cert: "no-se-usa-en-este-modo",
      key: "no-se-usa-en-este-modo",
      cuit: 23944498389,
      production: false,
      handleTicket: true,
      credentials: toLoginCredentials(ticket),
    })

    const accessTicket = await repo.login("wsfe")

    expect(accessTicket.getToken()).toBe("TOKEN-DE-AFIP")
    expect(accessTicket.getSign()).toBe("SIGN-DE-AFIP")
    expect(accessTicket.getExpiration().toISOString()).toBe("2026-08-30T11:35:00.000Z")
  })
})

describe("wsaaLogin", () => {
  const fakeAccessTicket = {
    getToken: () => "TOKEN-NUEVO",
    getSign: () => "SIGN-NUEVO",
    getExpiration: () => new Date("2026-08-30T11:35:00.000Z"),
  }

  it("traduce el AccessTicket del SDK a la forma que persiste wsaa_tickets", async () => {
    const result = await wsaaLogin(
      { cuit: "23944498389", certPem: "CERT", keyPem: "KEY", production: false, service: "wsfe" },
      { createAuthRepository: () => ({ requestLogin: async () => fakeAccessTicket }) }
    )

    expect(result).toEqual({
      token: "TOKEN-NUEVO",
      sign: "SIGN-NUEVO",
      expiresAt: "2026-08-30T11:35:00.000Z",
    })
  })

  it("le pasa al SDK el cert y la key del certificado, y el ambiente pedido", async () => {
    const recibido: Array<Record<string, unknown>> = []

    await wsaaLogin(
      { cuit: "23944498389", certPem: "CERT", keyPem: "KEY", production: true, service: "wsfe" },
      {
        createAuthRepository: (config) => {
          recibido.push(config)
          return { requestLogin: async () => fakeAccessTicket }
        },
      }
    )

    expect(recibido).toEqual([
      { cert: "CERT", key: "KEY", cuit: 23944498389, production: true },
    ])
  })
})
