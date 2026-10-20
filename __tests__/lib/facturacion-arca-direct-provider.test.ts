import { describe, it, expect, vi, afterEach } from "vitest"

import { createArcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
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
function fakeSdk(resultado: unknown = respuestaAprobada(), puntosVenta?: unknown) {
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
          getSalesPoints: async () => {
            if (puntosVenta instanceof Error) throw puntosVenta
            return puntosVenta
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

  describe("foto fiscal (fiscal)", () => {
    const emitirCon = async (c: ArcaCredenciales) => {
      const sdk = fakeSdk(respuestaAprobada(7))
      const provider = createArcaDirectProvider({
        renewTicket: async () => ticket,
        createArca: sdk.createArca,
        now: () => new Date("2026-08-29T15:00:00Z"),
      })
      return { result: await provider.emitir(c, input), sdk }
    }

    it("devuelve los importes y la fecha que se mandaron a ARCA", async () => {
      const { result, sdk } = await emitirCon(creds)
      const enviado = sdk.requests[0]

      expect(result.fiscal).toEqual({
        fechaEmision: "2026-08-29",
        cuitEmisor: "23944498389",
        cbteTipo: 11,
        concepto: 1,
        moneda: "PES",
        cotizacion: 1,
        importeNeto: enviado.ImpNeto,
        importeIva: enviado.ImpIVA,
        importeTotal: enviado.ImpTotal,
        receptorDocTipoCod: 99,
        receptorDocNro: "0",
      })
    })

    it("el emisor es el CUIT representado cuando la org delegó", async () => {
      const { result } = await emitirCon({ ...creds, cuitRepresentado: "30-71095505-7" })

      expect(result.fiscal?.cuitEmisor).toBe("30710955057")
    })

    it("un rechazo no trae foto fiscal", async () => {
      const sdk = fakeSdk({ response: { Errors: { Err: [{ Code: 10, Msg: "x" }] } } })
      const provider = createArcaDirectProvider({ renewTicket: async () => ticket, createArca: sdk.createArca })

      const result = await provider.emitir(creds, input)

      expect(result.ok).toBe(false)
      expect(result.fiscal).toBeUndefined()
    })
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
    // Sin esto, produccion falla con "dh key too small" (ver wsaa-login.test).
    expect(sdk.contextos[0].useHttpsAgent).toBe(true)
    expect(sdk.contextos[0].credentials.credentials).toEqual({ token: "TOK", sign: "SIG" })
  })
})

describe("arcaDirectProvider.emitir — caminos de error", () => {
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spyError.mockClear())

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
    // Una excepcion tecnica no se muestra cruda al admin: se guarda un mensaje
    // generico y el detalle va al log.
    expect(result.errores).toEqual([MENSAJE_ERROR_TECNICO])
    expect(spyError).toHaveBeenCalled()
    expect(sdk.contextos).toHaveLength(0)
  })

  it("una excepcion del SDK al emitir no filtra su mensaje tecnico", async () => {
    const provider = createArcaDirectProvider({
      renewTicket: async () => ticket,
      createArca: () => ({
        electronicBillingService: {
          createNextVoucher: async () => {
            throw new Error("getaddrinfo ENOTFOUND servicios1.afip.gov.ar")
          },
        },
      }) as any,
    })

    const result = await provider.emitir(creds, input)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result.errores)).not.toContain("ENOTFOUND")
    expect(result.errores).toEqual([MENSAJE_ERROR_TECNICO])
  })

  it("un rechazo de negocio de ARCA conserva su texto accionable", async () => {
    const sdk = fakeSdk({
      response: {
        FeDetResp: {
          FECAEDetResponse: [{ Resultado: "R", Observaciones: { Obs: [{ Code: 10015, Msg: "Doc invalido" }] } }],
        },
      },
    })
    const provider = createArcaDirectProvider({ renewTicket: async () => ticket, createArca: sdk.createArca })

    const result = await provider.emitir(creds, input)

    expect(result.errores?.join(" ")).toContain("10015")
  })

  it("una alícuota no soportada vuelve como rechazo con el motivo y sin llamar a ARCA", async () => {
    const sdk = fakeSdk()
    const provider = createArcaDirectProvider({
      renewTicket: async () => ticket,
      createArca: sdk.createArca,
    })

    const result = await provider.emitir(
      { ...creds, condicionFiscal: "RESPONSABLE_INSCRIPTO" },
      { ...input, items: [{ cantidad: 1, descripcion: "A", importeUnitario: 1000, importe: 1000, alicuotaIva: 15 }] }
    )

    expect(result.ok).toBe(false)
    expect(result.errores).toEqual(["Alícuota de IVA no soportada por ARCA: 15%"])
    expect(sdk.requests).toHaveLength(0)
  })
})

/**
 * En BYO el error de configuracion se detecta al subir el certificado: el PUT
 * valida el par contra el CUIT declarado. En DELEGACION no hay nada que
 * validar localmente — la delegacion vive del lado de AFIP. La unica forma de
 * saber si el tramite quedo bien es preguntarle a AFIP, y sin este diagnostico
 * el taller se entera cuando le falla una factura con un cliente esperando.
 */
describe("arcaDirectProvider.probarConexion", () => {
  it("devuelve los puntos de venta habilitados", async () => {
    const sdk = fakeSdk(respuestaAprobada(), {
      resultGet: {
        ptoVenta: [
          { nro: 1, emisionTipo: "CAE - Monotributo", bloqueado: "N", fechaBaja: "NULL" },
          { nro: 5, emisionTipo: "CAE", bloqueado: "S", fechaBaja: "NULL" },
        ],
      },
    })
    const provider = createArcaDirectProvider({ renewTicket: async () => ticket, createArca: sdk.createArca })

    const res = await provider.probarConexion(creds)

    expect(res.ok).toBe(true)
    expect(res.puntosVenta).toEqual([
      { numero: 1, bloqueado: false },
      { numero: 5, bloqueado: true },
    ])
  })

  /**
   * 602 "Sin Resultados" NO es un fallo de delegacion: significa que AFIP nos
   * atendio en nombre de ese CUIT y no encontro puntos de venta. El taller
   * tiene que darlos de alta, que es un problema distinto y accionable.
   */
  it("trata el 602 como conexion OK sin puntos de venta", async () => {
    const sdk = fakeSdk(respuestaAprobada(), {
      resultGet: { ptoVenta: [] },
      errors: { err: [{ code: 602, msg: "Sin Resultados" }] },
    })
    const provider = createArcaDirectProvider({ renewTicket: async () => ticket, createArca: sdk.createArca })

    const res = await provider.probarConexion(creds)

    expect(res.ok).toBe(true)
    expect(res.puntosVenta).toEqual([])
  })

  it("reporta el error de AFIP cuando la delegación no está hecha", async () => {
    const sdk = fakeSdk(respuestaAprobada(), {
      errors: { err: [{ code: 600, msg: "CUIT representada no autorizada" }] },
    })
    const provider = createArcaDirectProvider({ renewTicket: async () => ticket, createArca: sdk.createArca })

    const res = await provider.probarConexion(creds)

    expect(res.ok).toBe(false)
    expect(res.error).toContain("600")
    expect(res.error).toContain("no autorizada")
  })

  it("no propaga la excepción si falla la renovación del ticket", async () => {
    const sdk = fakeSdk()
    const provider = createArcaDirectProvider({
      renewTicket: async () => {
        throw new Error("lease ocupado")
      },
      createArca: sdk.createArca,
    })

    const res = await provider.probarConexion(creds)

    expect(res.ok).toBe(false)
    expect(res.error).toBe("lease ocupado")
  })
})
