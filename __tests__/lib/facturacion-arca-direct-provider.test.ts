import { describe, it, expect } from "vitest"

import { createArcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import type { ArcaCredenciales, EmitirInput } from "@/lib/facturacion/types"

const creds: ArcaCredenciales = {
  organizationId: "org-1",
  cuit: "23944498389",
  certPem: "CERT",
  keyPem: "KEY",
  puntoVenta: 1,
  condicionFiscal: "MONOTRIBUTO",
  production: false,
}

const input: EmitirInput = {
  ventaId: "venta-1",
  moneda: "PES",
  total: 1000,
  receptor: {
    razonSocial: "Consumidor Final",
    documentoTipo: "CONSUMIDOR FINAL",
    documentoNro: "0",
    condicionIva: "CF",
  },
  items: [{ cantidad: 1, descripcion: "Cambio de pantalla", importeUnitario: 1000, alicuotaIva: 21 }],
}

const ticket = {
  token: "TOK",
  sign: "SIG",
  expiresAt: "2026-08-30T11:35:00.000Z",
  generatedAt: "2026-08-29T23:35:00.000Z",
}

function respuestaAprobada(cbteDesde = 7) {
  return {
    cae: "75123456789012",
    caeFchVto: "20260908",
    response: {
      FeCabResp: { Resultado: "A" },
      FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: cbteDesde }] },
    },
  }
}

/** Doble del SDK: registra el contexto recibido y la request enviada. */
function fakeSdk(resultado: unknown = respuestaAprobada()) {
  const contextos: any[] = []
  const requests: any[] = []
  return {
    contextos,
    requests,
    createArca: (context: any) => {
      contextos.push(context)
      return {
        electronicBillingService: {
          createNextVoucher: async (req: any) => {
            requests.push(req)
            return resultado
          },
        },
      }
    },
  }
}

describe("arcaDirectProvider.emitir", () => {
  it("devuelve el CAE y el número de comprobante formateado", async () => {
    const sdk = fakeSdk(respuestaAprobada(7))
    const provider = createArcaDirectProvider({
      renewTicket: async () => ticket,
      createArca: sdk.createArca,
    })

    const result = await provider.emitir(creds, input)

    expect(result.ok).toBe(true)
    expect(result.tipo).toBe("C")
    expect(result.cae).toBe("75123456789012")
    expect(result.caeVencimiento).toBe("20260908")
    expect(result.numero).toBe("0001-00000007")
  })

  /**
   * AFIP deriva la identidad del WSAA del subject del CERTIFICADO, no del
   * `Auth.Cuit`. En el modelo de delegación un solo certificado representa a
   * N talleres, así que el cache del TA debe keyearse por el CUIT del
   * certificado: keyearlo por el representado produciría un login por taller
   * y AFIP los rechaza con `coe.alreadyAuthenticated`.
   */
  it("keyea el ticket WSAA por el CUIT del certificado, no por el representado", async () => {
    const sdk = fakeSdk()
    const keys: any[] = []
    const provider = createArcaDirectProvider({
      renewTicket: async (options: any) => {
        keys.push(options.key)
        return ticket
      },
      createArca: sdk.createArca,
    })

    await provider.emitir({ ...creds, cuitRepresentado: "30710955057" }, input)

    expect(keys).toEqual([
      { organizationId: "org-1", cuit: "23944498389", service: "wsfe", production: false },
    ])
  })

  it("le manda al SDK el CUIT representado como emisor del comprobante", async () => {
    const sdk = fakeSdk()
    const provider = createArcaDirectProvider({
      renewTicket: async () => ticket,
      createArca: sdk.createArca,
    })

    await provider.emitir({ ...creds, cuitRepresentado: "30710955057" }, input)

    expect(sdk.contextos[0].cuit).toBe(30710955057)
    expect(sdk.contextos[0].handleTicket).toBe(true)
    expect(sdk.contextos[0].credentials.credentials).toEqual({ token: "TOK", sign: "SIG" })
  })
})

describe("arcaDirectProvider.emitir — caminos de error", () => {
  it("reporta las observaciones cuando ARCA rechaza el comprobante", async () => {
    const sdk = fakeSdk({
      cae: "",
      caeFchVto: "",
      response: {
        FeCabResp: { Resultado: "R" },
        FeDetResp: {
          FECAEDetResponse: [
            {
              Resultado: "R",
              Observaciones: { Obs: [{ Code: 10048, Msg: "El campo ImpTotal no es igual a la suma" }] },
            },
          ],
        },
      },
    })
    const provider = createArcaDirectProvider({
      renewTicket: async () => ticket,
      createArca: sdk.createArca,
    })

    const result = await provider.emitir(creds, input)

    expect(result.ok).toBe(false)
    expect(result.cae).toBeUndefined()
    expect(result.errores).toEqual(["10048: El campo ImpTotal no es igual a la suma"])
  })

  /**
   * Mismo contrato que `tusfacturas-provider`: la ruta de emisión espera un
   * `ComprobanteResult`, nunca una excepción. Un WSAA caído no puede tumbar
   * el endpoint.
   */
  it("no propaga la excepción si falla la renovación del ticket WSAA", async () => {
    const sdk = fakeSdk()
    const provider = createArcaDirectProvider({
      renewTicket: async () => {
        throw new Error("lease ocupado")
      },
      createArca: sdk.createArca,
    })

    const result = await provider.emitir(creds, input)

    expect(result.ok).toBe(false)
    expect(result.errores).toEqual(["lease ocupado"])
    expect(sdk.contextos).toHaveLength(0)
  })
})
