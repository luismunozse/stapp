import { describe, it, expect, vi, afterEach } from "vitest"
import type { IVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"

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

const llamadaNoEsperada = async (): Promise<never> => {
  throw new Error("este test no esperaba esa llamada al SDK")
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
          // Las capacidades de nota de crédito tienen su propio doble más abajo
          // (`fakeSdkNc`); acá solo completan el tipo `ArcaLike`.
          createVoucher: llamadaNoEsperada,
          getVoucherInfo: llamadaNoEsperada,
          getLastVoucher: llamadaNoEsperada,
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

// ============================================================================
// Anulación con nota de crédito: consultar / ultimoAutorizado / emitirNotaCredito
// ============================================================================

/** Un valor `Error` se lanza; cualquier otro se devuelve (mismo patrón que `fakeSdk`). */
async function resolverOLanzar(valor: unknown) {
  if (valor instanceof Error) throw valor
  return valor
}

/**
 * Doble del SDK para consulta / último número / envío de NC. Registra cada
 * llamada con sus argumentos y deja `createNextVoucher` rastreable: una NC jamás
 * debe usarlo (numeraría sola y podría emitir una segunda).
 */
function fakeSdkNc(opts: { info?: unknown; ultimo?: unknown; creada?: unknown } = {}) {
  const contextos: any[] = []
  const consultas: Array<[number, number, number]> = []
  const ultimos: Array<[number, number]> = []
  const enviados: any[] = []
  const siguientes: any[] = []
  return {
    contextos,
    consultas,
    ultimos,
    enviados,
    siguientes,
    createArca: (context: any) => {
      contextos.push(context)
      return {
        electronicBillingService: {
          createNextVoucher: async (req: any) => {
            siguientes.push(req)
            return undefined
          },
          getSalesPoints: llamadaNoEsperada,
          getVoucherInfo: async (nro: number, pv: number, tipo: number) => {
            consultas.push([nro, pv, tipo])
            return resolverOLanzar(opts.info)
          },
          getLastVoucher: async (pv: number, tipo: number) => {
            ultimos.push([pv, tipo])
            return resolverOLanzar(opts.ultimo)
          },
          createVoucher: async (req: any) => {
            enviados.push(req)
            return resolverOLanzar(opts.creada)
          },
        },
      }
    },
  }
}

const proveedorNc = (sdk: { createArca: (context: any) => any }, renewTicket = async () => ticket) =>
  createArcaDirectProvider({ renewTicket, createArca: sdk.createArca })

/** Lo que `getVoucherInfo` del SDK devuelve para la NC B número 5 del punto de venta 3. */
const infoSdkNcB = {
  codAutorizacion: "70000000000042",
  emisionTipo: "CAE",
  fchVto: "20261030",
  fchProceso: "20261020113000",
  resultado: "A",
  concepto: 1,
  docTipo: 99,
  docNro: 0,
  cbteDesde: 5,
  cbteHasta: 5,
  cbteFch: "20261020",
  impTotal: 1210,
  impTotConc: 0,
  impNeto: 1000,
  impOpEx: 0,
  impIVA: 210,
  impTrib: 0,
  monId: "PES",
  monCotiz: 1,
}

describe("arcaDirectProvider.consultar", () => {
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spyError.mockClear())

  const ref = { puntoVenta: 3, cbteTipoAfip: 8, cbteNro: 5 }

  it("traduce la respuesta del SDK a ConsultaResult con nuestros nombres", async () => {
    const sdk = fakeSdkNc({ info: infoSdkNcB })

    const res = await proveedorNc(sdk).consultar(creds, ref)

    expect(res).toEqual({
      existe: true,
      cbteNro: 5,
      cae: "70000000000042",
      caeVencimiento: "20261030",
      resultado: "A",
      cbteFch: "20261020",
      concepto: 1,
      docTipo: 99,
      docNro: "0",
      impTotal: 1210,
      impNeto: 1000,
      impIva: 210,
      impTrib: 0,
      impOpEx: 0,
      impTotConc: 0,
      moneda: "PES",
      cotizacion: 1,
    })
  })

  it("le pasa al SDK (número, punto de venta, tipo) del ref, no el punto de venta de las credenciales", async () => {
    const sdk = fakeSdkNc({ info: infoSdkNcB })

    await proveedorNc(sdk).consultar({ ...creds, puntoVenta: 1 }, ref)

    expect(sdk.consultas).toEqual([[5, 3, 8]])
  })

  it("el documento del receptor vuelve como cadena de dígitos (el SDK lo da como número)", async () => {
    const sdk = fakeSdkNc({ info: { ...infoSdkNcB, docTipo: 80, docNro: 20111111112 } })

    const res = await proveedorNc(sdk).consultar(creds, ref)

    expect(res.docTipo).toBe(80)
    expect(res.docNro).toBe("20111111112")
  })

  it("tolera importes y documento que lleguen como texto numérico", async () => {
    const sdk = fakeSdkNc({
      info: { ...infoSdkNcB, impTotal: "1210.50", impIVA: "210.5", docNro: "30111111118", cbteDesde: "5", cbteHasta: "5" },
    })

    const res = await proveedorNc(sdk).consultar(creds, ref)

    expect(res.impTotal).toBe(1210.5)
    expect(res.impIva).toBe(210.5)
    expect(res.docNro).toBe("30111111118")
    expect(res.cbteNro).toBe(5)
  })

  it("un valor ilegible queda sin informar en vez de inventarse (el armado de la NC lo rechaza)", async () => {
    const sdk = fakeSdkNc({ info: { ...infoSdkNcB, impTotal: "abc", impNeto: Number.POSITIVE_INFINITY, docNro: "12.5", monId: "", fchVto: null } })

    const res = await proveedorNc(sdk).consultar(creds, ref)

    expect(res.existe).toBe(true)
    expect(res.impTotal).toBeUndefined()
    expect(res.impNeto).toBeUndefined()
    expect(res.docNro).toBeUndefined()
    expect(res.moneda).toBeUndefined()
    expect(res.caeVencimiento).toBeUndefined()
  })

  it("no informa el número si CbteDesde y CbteHasta difieren o falta uno", async () => {
    const rango = await proveedorNc(fakeSdkNc({ info: { ...infoSdkNcB, cbteDesde: 5, cbteHasta: 6 } })).consultar(creds, ref)
    const sinHasta = await proveedorNc(fakeSdkNc({ info: { ...infoSdkNcB, cbteHasta: undefined } })).consultar(creds, ref)

    expect(rango.existe).toBe(true)
    expect(rango.cbteNro).toBeUndefined()
    expect(sinHasta.cbteNro).toBeUndefined()
  })

  it("el SDK devuelve null: existe:false (la conciliación lo confirma con el último autorizado)", async () => {
    const sdk = fakeSdkNc({ info: null })

    await expect(proveedorNc(sdk).consultar(creds, ref)).resolves.toEqual({ existe: false })
  })

  it("una respuesta con errores de ARCA no es confiable aunque traiga datos: lanza", async () => {
    const sdk = fakeSdkNc({ info: { ...infoSdkNcB, errors: { err: [{ code: 600, msg: "ValidacionDeToken: No validaron las fechas del token" }] } } })

    const error = await proveedorNc(sdk)
      .consultar(creds, ref)
      .then(
        () => null,
        (e: Error) => e
      )

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(MENSAJE_ERROR_TECNICO)
    expect(error?.message).not.toContain("ValidacionDeToken")
    expect(spyError).toHaveBeenCalled()
  })

  it("una excepción del SDK se propaga con un mensaje genérico y el detalle va al log", async () => {
    const sdk = fakeSdkNc({ info: new Error("getaddrinfo ENOTFOUND servicios1.afip.gov.ar") })

    const error = await proveedorNc(sdk)
      .consultar(creds, ref)
      .then(
        () => null,
        (e: Error) => e
      )

    expect(error?.message).toBe(MENSAJE_ERROR_TECNICO)
    expect(error?.message).not.toContain("ENOTFOUND")
    expect(spyError).toHaveBeenCalled()
  })

  it("si falla la autenticación lanza y no llega a consultar", async () => {
    const sdk = fakeSdkNc({ info: infoSdkNcB })
    const proveedor = proveedorNc(sdk, async () => {
      throw new Error("lease ocupado")
    })

    await expect(proveedor.consultar(creds, ref)).rejects.toThrow(MENSAJE_ERROR_TECNICO)
    expect(sdk.contextos).toHaveLength(0)
    expect(sdk.consultas).toHaveLength(0)
  })
})

describe("arcaDirectProvider.ultimoAutorizado", () => {
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spyError.mockClear())

  it("devuelve el último número autorizado del punto de venta y tipo pedidos", async () => {
    const sdk = fakeSdkNc({ ultimo: { cbteNro: 4, cbteTipo: 8, ptoVta: 3 } })

    await expect(proveedorNc(sdk).ultimoAutorizado({ ...creds, puntoVenta: 1 }, 3, 8)).resolves.toBe(4)
    expect(sdk.ultimos).toEqual([[3, 8]])
  })

  it("0 significa que todavía no se emitió ninguno", async () => {
    const sdk = fakeSdkNc({ ultimo: { cbteNro: 0, cbteTipo: 13, ptoVta: 2 } })

    await expect(proveedorNc(sdk).ultimoAutorizado(creds, 2, 13)).resolves.toBe(0)
  })

  it("lanza si ARCA informa errores, aunque el número venga en cero", async () => {
    const sdk = fakeSdkNc({
      ultimo: { cbteNro: 0, cbteTipo: 8, ptoVta: 3, errors: { err: [{ code: 600, msg: "CUIT representada no autorizada" }] } },
    })

    const error = await proveedorNc(sdk)
      .ultimoAutorizado(creds, 3, 8)
      .then(
        () => null,
        (e: Error) => e
      )

    expect(error?.message).toBe(MENSAJE_ERROR_TECNICO)
    expect(error?.message).not.toContain("CUIT representada")
    expect(spyError).toHaveBeenCalled()
  })

  it.each([
    ["no informado", undefined],
    ["null", null],
    ["texto", "5"],
    ["decimal", 1.5],
    ["negativo", -1],
    ["NaN", Number.NaN],
  ])("lanza si el último número es inválido (%s): jamás se numera sobre un dato dudoso", async (_caso, cbteNro) => {
    const sdk = fakeSdkNc({ ultimo: { cbteNro, cbteTipo: 8, ptoVta: 3 } })

    await expect(proveedorNc(sdk).ultimoAutorizado(creds, 3, 8)).rejects.toThrow(MENSAJE_ERROR_TECNICO)
  })

  it("lanza si el SDK no devuelve nada", async () => {
    const sdk = fakeSdkNc({ ultimo: undefined })

    await expect(proveedorNc(sdk).ultimoAutorizado(creds, 3, 8)).rejects.toThrow(MENSAJE_ERROR_TECNICO)
  })

  it("una excepción del SDK se propaga con un mensaje genérico", async () => {
    const sdk = fakeSdkNc({ ultimo: new Error("socket hang up") })

    const error = await proveedorNc(sdk)
      .ultimoAutorizado(creds, 3, 8)
      .then(
        () => null,
        (e: Error) => e
      )

    expect(error?.message).toBe(MENSAJE_ERROR_TECNICO)
    expect(error?.message).not.toContain("socket")
  })

  it("si falla la autenticación lanza y no llega a consultar", async () => {
    const sdk = fakeSdkNc({ ultimo: { cbteNro: 4 } })
    const proveedor = proveedorNc(sdk, async () => {
      throw new Error("lease ocupado")
    })

    await expect(proveedor.ultimoAutorizado(creds, 3, 8)).rejects.toThrow(MENSAJE_ERROR_TECNICO)
    expect(sdk.ultimos).toHaveLength(0)
  })
})

/** Voucher de una NC B (8) ya numerada: lo que la ruta le entrega a `emitirNotaCredito`. */
const voucherNcB: IVoucher = {
  CantReg: 1,
  PtoVta: 3,
  CbteTipo: 8,
  Concepto: 1,
  DocTipo: 99,
  DocNro: 0,
  CbteDesde: 5,
  CbteHasta: 5,
  CbteFch: "20261020",
  ImpTotal: 1210,
  ImpTotConc: 0,
  ImpNeto: 1000,
  ImpOpEx: 0,
  ImpIVA: 210,
  ImpTrib: 0,
  MonId: "PES",
  MonCotiz: 1,
  CondicionIVAReceptorId: 5,
  CbtesAsoc: [{ Tipo: 6, PtoVta: 3, Nro: 1, Cuit: "20111111112", CbteFch: "20261015" }],
  Iva: [{ Id: 5, BaseImp: 1000, Importe: 210 }],
}

const voucherNcC: IVoucher = {
  ...voucherNcB,
  CbteTipo: 13,
  ImpNeto: 1210,
  ImpIVA: 0,
  CbtesAsoc: [{ Tipo: 11, PtoVta: 3, Nro: 1, Cuit: "20111111112", CbteFch: "20261015" }],
  Iva: undefined,
}

const respuestaNcAutorizada = (over: Record<string, unknown> = {}) => ({
  cae: "70000000000042",
  caeFchVto: "20261030",
  response: {
    FeCabResp: { Resultado: "A" },
    FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: 5, CbteHasta: 5 }] },
  },
  ...over,
})

describe("arcaDirectProvider.emitirNotaCredito — desenlaces del envío", () => {
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spyError.mockClear())

  it("A con CAE: autorizada, con el número formateado, el CAE y su vencimiento", async () => {
    const creada = respuestaNcAutorizada()
    const sdk = fakeSdkNc({ creada })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({
      kind: "autorizada",
      numero: "0003-00000005",
      cae: "70000000000042",
      caeVencimiento: "20261030",
      raw: creada.response,
    })
  })

  it("manda el voucher tal cual con su número explícito y NUNCA usa createNextVoucher", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(sdk.enviados).toEqual([voucherNcB])
    expect(sdk.enviados[0].CbteDesde).toBe(5)
    expect(sdk.enviados[0].CbteHasta).toBe(5)
    expect(sdk.siguientes).toHaveLength(0)
  })

  it("el número lleva el punto de venta del voucher enviado, no el de las credenciales", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    const res = await proveedorNc(sdk).emitirNotaCredito({ ...creds, puntoVenta: 1 }, voucherNcB)

    expect(res.kind === "autorizada" && res.numero).toBe("0003-00000005")
  })

  it("si la respuesta no repite el número, usa el que se envió", async () => {
    const sdk = fakeSdkNc({
      creada: respuestaNcAutorizada({ response: { FeDetResp: { FECAEDetResponse: [{ Resultado: "A" }] } } }),
    })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res.kind === "autorizada" && res.numero).toBe("0003-00000005")
  })

  it("una Nota de crédito C (13) también se envía", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcC)

    expect(res.kind).toBe("autorizada")
    expect(sdk.enviados).toEqual([voucherNcC])
  })

  it("R con observaciones: rechazada con el texto accionable de ARCA y la respuesta cruda", async () => {
    const response = {
      FeCabResp: { Resultado: "R" },
      FeDetResp: {
        FECAEDetResponse: [
          { Resultado: "R", Observaciones: { Obs: [{ Code: 10016, Msg: "El numero o fecha del comprobante no se corresponde con el proximo a autorizar" }] } },
        ],
      },
    }
    const sdk = fakeSdkNc({ creada: { cae: "", caeFchVto: "", response } })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({
      kind: "rechazada",
      errores: ["10016: El numero o fecha del comprobante no se corresponde con el proximo a autorizar"],
      raw: response,
    })
  })

  it("Resultado R en la cabecera MÁS Errors a nivel pedido: rechazada (rechazo explícito de ARCA)", async () => {
    const response = {
      FeCabResp: { Resultado: "R" },
      Errors: { Err: [{ Code: 10197, Msg: "Para comprobantes tipo NC se debe informar CbtesAsoc" }] },
    }
    const sdk = fakeSdkNc({ creada: { cae: "", caeFchVto: "", response } })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({
      kind: "rechazada",
      errores: ["10197: Para comprobantes tipo NC se debe informar CbtesAsoc"],
      raw: response,
    })
  })

  it("Resultado R en el detalle MÁS Errors a nivel pedido: rechazada", async () => {
    const response = {
      FeDetResp: { FECAEDetResponse: [{ Resultado: "R" }] },
      Errors: { Err: [{ Code: 10015, Msg: "Doc invalido" }] },
    }
    const sdk = fakeSdkNc({ creada: { cae: "", caeFchVto: "", response } })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res.kind).toBe("rechazada")
    expect(res.kind === "rechazada" && res.errores.join(" ")).toContain("10015")
  })

  it.each([
    ["500 (Error interno)", { Code: 500, Msg: "Error interno de aplicacion" }],
    ["501 (Error interno de base de datos)", { Code: 501, Msg: "Error interno de base de datos" }],
    ["502 (Error interno)", { Code: 502, Msg: "Error interno" }],
    ["10197 sin Resultado", { Code: 10197, Msg: "Para comprobantes tipo NC se debe informar CbtesAsoc" }],
  ])(
    "Errors a nivel pedido %s SIN Resultado: incierta (ARCA pudo haberla emitido), la fila sigue pendiente",
    async (_caso, err) => {
      const response = { Errors: { Err: [err] } }
      const sdk = fakeSdkNc({ creada: { cae: "", caeFchVto: "", response } })

      const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

      expect(res).toEqual({ kind: "incierta", error: expect.any(String) })
      expect(spyError).toHaveBeenCalled()
    }
  )

  it("Resultado A con CAE: autorizada aunque la respuesta traiga Errors (un Errors suelto no pisa la autorización)", async () => {
    const creada = respuestaNcAutorizada()
    creada.response = { ...creada.response, Errors: { Err: [{ Code: 500, Msg: "ruido" }] } } as any
    const sdk = fakeSdkNc({ creada })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res.kind).toBe("autorizada")
  })

  it("R solo en el detalle del comprobante (cabecera sin resultado): también es rechazada", async () => {
    const response = {
      FeDetResp: {
        FECAEDetResponse: [{ Resultado: "R", Observaciones: { Obs: [{ Code: 10015, Msg: "Doc invalido" }] } }],
      },
    }
    const sdk = fakeSdkNc({ creada: { cae: "", caeFchVto: "", response } })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({ kind: "rechazada", errores: ["10015: Doc invalido"], raw: response })
  })

  it("rechazo en la cabecera sin detalle: rechazada con el mensaje por defecto", async () => {
    const response = { FeCabResp: { Resultado: "R" } }
    const sdk = fakeSdkNc({ creada: { cae: "", caeFchVto: "", response } })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({
      kind: "rechazada",
      errores: ["ARCA rechazó el comprobante sin detallar el motivo"],
      raw: response,
    })
  })

  it("createVoucher lanza: INCIERTA (ARCA pudo haberla emitido), con mensaje genérico y detalle al log", async () => {
    const sdk = fakeSdkNc({ creada: new Error("getaddrinfo ENOTFOUND servicios1.afip.gov.ar") })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({ kind: "incierta", error: MENSAJE_ERROR_TECNICO })
    expect(JSON.stringify(res)).not.toContain("ENOTFOUND")
    expect(spyError).toHaveBeenCalled()
    expect(sdk.enviados).toHaveLength(1)
  })

  it("lanzar algo que no es un Error también es incierta, sin propagar la excepción", async () => {
    const sdk = fakeSdkNc({ creada: undefined })
    const lanzaTexto = (context: any) => ({
      electronicBillingService: {
        ...sdk.createArca(context).electronicBillingService,
        createVoucher: async () => {
          throw "timeout"
        },
      },
    })

    const res = await createArcaDirectProvider({ renewTicket: async () => ticket, createArca: lanzaTexto }).emitirNotaCredito(
      creds,
      voucherNcB
    )

    expect(res).toEqual({ kind: "incierta", error: MENSAJE_ERROR_TECNICO })
  })

  it.each([
    ["no devuelve nada", undefined],
    ["devuelve un objeto vacío", {}],
    ["responde sin resultado ni errores", { cae: "", caeFchVto: "", response: {} }],
    ["responde Resultado parcial (P)", { cae: "", caeFchVto: "", response: { FeDetResp: { FECAEDetResponse: [{ Resultado: "P" }] } } }],
    ["autoriza (A) pero sin CAE", respuestaNcAutorizada({ cae: "" })],
    ["autoriza (A) con CAE pero sin vencimiento", respuestaNcAutorizada({ caeFchVto: "" })],
    [
      "autoriza con un número distinto del que se envió",
      respuestaNcAutorizada({ response: { FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: 7 }] } } }),
    ],
  ])("createVoucher %s: incierta, nunca se da por rechazada ni por autorizada", async (_caso, creada) => {
    const sdk = fakeSdkNc({ creada })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, voucherNcB)

    expect(res.kind).toBe("incierta")
  })
})

describe("arcaDirectProvider.emitirNotaCredito — fallas ANTES de enviar (rechazada: ARCA no recibió nada)", () => {
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spyError.mockClear())

  it("si falla la renovación del ticket WSAA: rechazada, mensaje genérico y no se contacta a ARCA", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })
    const proveedor = proveedorNc(sdk, async () => {
      throw new Error("lease ocupado")
    })

    const res = await proveedor.emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({ kind: "rechazada", errores: [MENSAJE_ERROR_TECNICO], raw: null })
    expect(spyError).toHaveBeenCalled()
    expect(sdk.contextos).toHaveLength(0)
    expect(sdk.enviados).toHaveLength(0)
  })

  it("si falla armar el cliente del SDK: rechazada", async () => {
    const proveedor = createArcaDirectProvider({
      renewTicket: async () => ticket,
      createArca: () => {
        throw new Error("certificado ilegible")
      },
    })

    const res = await proveedor.emitirNotaCredito(creds, voucherNcB)

    expect(res).toEqual({ kind: "rechazada", errores: [MENSAJE_ERROR_TECNICO], raw: null })
  })

  it.each([
    ["una Factura B (6)", 6],
    ["una Factura C (11)", 11],
    ["un tipo desconocido (1)", 1],
  ])("un voucher de %s no es una nota de crédito: rechazada sin enviar ni autenticar", async (_caso, CbteTipo) => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, { ...voucherNcB, CbteTipo })

    expect(res.kind).toBe("rechazada")
    expect(res.kind === "rechazada" && res.errores.join(" ")).toContain("nota de crédito")
    expect(sdk.contextos).toHaveLength(0)
    expect(sdk.enviados).toHaveLength(0)
  })

  it("un rango de números (CbteDesde distinto de CbteHasta) no se envía: la NC va con UN número explícito", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, { ...voucherNcB, CbteHasta: 6, CantReg: 2 })

    expect(res.kind).toBe("rechazada")
    expect(res.kind === "rechazada" && res.errores.join(" ")).toContain("número")
    expect(sdk.enviados).toHaveLength(0)
  })

  it("sin número (CbteDesde/CbteHasta sin asignar, como sale del armado): rechazada sin enviar", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })
    const { CbteDesde: _d, CbteHasta: _h, ...sinNumero } = voucherNcB

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, sinNumero as unknown as IVoucher)

    expect(res.kind).toBe("rechazada")
    expect(res.kind === "rechazada" && res.errores.join(" ")).toContain("número explícito")
    expect(sdk.contextos).toHaveLength(0)
    expect(sdk.enviados).toHaveLength(0)
  })

  it.each([
    ["decimal", 5.5],
    ["cero", 0],
    ["negativo", -3],
  ])("un número %s no es un número de comprobante: rechazada sin enviar", async (_caso, numero) => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    const res = await proveedorNc(sdk).emitirNotaCredito(creds, { ...voucherNcB, CbteDesde: numero, CbteHasta: numero })

    expect(res.kind).toBe("rechazada")
    expect(res.kind === "rechazada" && res.errores.join(" ")).toContain("número explícito")
    expect(sdk.enviados).toHaveLength(0)
  })

  it("un voucher que no pasa la validación del SDK es rechazada, no incierta: no sale de acá", async () => {
    const sdk = fakeSdkNc({ creada: respuestaNcAutorizada() })

    // ImpTotal no cierra con neto + IVA: el SDK lo rechaza antes de la red.
    const res = await proveedorNc(sdk).emitirNotaCredito(creds, { ...voucherNcB, ImpTotal: 9999 })

    expect(res).toEqual({ kind: "rechazada", errores: [MENSAJE_ERROR_TECNICO], raw: null })
    expect(spyError).toHaveBeenCalled()
    expect(sdk.contextos).toHaveLength(0)
    expect(sdk.enviados).toHaveLength(0)
  })
})

describe("arcaDirectProvider — mismo ticket y contexto para consultar, último número y NC", () => {
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spyError.mockClear())

  const operaciones: Array<[string, (p: ReturnType<typeof proveedorNc>, c: ArcaCredenciales) => Promise<unknown>]> = [
    ["consultar", (p, c) => p.consultar(c, { puntoVenta: 3, cbteTipoAfip: 8, cbteNro: 5 })],
    ["ultimoAutorizado", (p, c) => p.ultimoAutorizado(c, 3, 8)],
    ["emitirNotaCredito", (p, c) => p.emitirNotaCredito(c, voucherNcB)],
  ]

  it.each(operaciones)("%s keyea el ticket por el CUIT del certificado, no por el representado", async (_n, operar) => {
    const sdk = fakeSdkNc({ info: infoSdkNcB, ultimo: { cbteNro: 4 }, creada: respuestaNcAutorizada() })
    const keys: any[] = []
    const proveedor = createArcaDirectProvider({
      renewTicket: async (options: any) => {
        keys.push(options.key)
        return ticket
      },
      createArca: sdk.createArca,
    })

    await operar(proveedor, { ...creds, cuitRepresentado: "30710955057" })

    expect(keys).toEqual([{ organizationId: "org-1", cuit: "23944498389", service: "wsfe", production: false }])
  })

  it.each(operaciones)("%s le manda al SDK el CUIT representado y el ticket inyectado", async (_n, operar) => {
    const sdk = fakeSdkNc({ info: infoSdkNcB, ultimo: { cbteNro: 4 }, creada: respuestaNcAutorizada() })

    await operar(proveedorNc(sdk), { ...creds, cuitRepresentado: "30710955057" })

    expect(sdk.contextos[0].cuit).toBe(30710955057)
    expect(sdk.contextos[0].handleTicket).toBe(true)
    expect(sdk.contextos[0].useHttpsAgent).toBe(true)
    expect(sdk.contextos[0].credentials.credentials).toEqual({ token: "TOK", sign: "SIG" })
  })
})
