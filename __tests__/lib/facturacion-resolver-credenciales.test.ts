import { describe, it, expect, beforeAll, vi } from "vitest"

vi.mock("@/lib/facturacion/arca/stapp-cert", () => ({
  getCertificadoStapp: vi.fn(() => ({
    cuit: "23944498389",
    certPem: "CERT-PLATAFORMA",
    keyPem: "KEY-PLATAFORMA",
    notAfter: "2028-09-12T22:16:31.000Z",
    subject: "CN=stapp-prod",
  })),
}))

import { encryptSecret } from "@/lib/facturacion/crypto"
import {
  resolverCredenciales,
  CredencialesIncompletasError,
} from "@/lib/facturacion/resolver-credenciales"

beforeAll(() => {
  process.env.FACTURACION_ENCRYPTION_KEY = "test-key-at-least-32-chars-long-xxxxx"
})

describe("resolverCredenciales", () => {
  it("arma las credenciales ARCA descifrando el certificado y la clave", () => {
    const resuelto = resolverCredenciales({
      organizationId: "org-1",
      production: false,
      row: {
        provider: "arca",
        cuit: "23944498389",
        cert_pem_enc: encryptSecret("CERT-PEM"),
        key_pem_enc: encryptSecret("KEY-PEM"),
        punto_venta: 3,
        condicion_fiscal: "MONOTRIBUTO",
      },
    })

    expect(resuelto).toEqual({
      provider: "arca",
      creds: {
        organizationId: "org-1",
        cuit: "23944498389",
        certPem: "CERT-PEM",
        keyPem: "KEY-PEM",
        puntoVenta: 3,
        condicionFiscal: "MONOTRIBUTO",
        production: false,
      },
    })
  })

  it("arma las credenciales de TusFacturas descifrando los tres tokens", () => {
    const resuelto = resolverCredenciales({
      organizationId: "org-1",
      production: false,
      row: {
        provider: "tusfacturas",
        apitoken_enc: encryptSecret("APITOKEN"),
        apikey_enc: encryptSecret("APIKEY"),
        usertoken_enc: encryptSecret("USERTOKEN"),
        punto_venta: 1,
        condicion_fiscal: "RESPONSABLE_INSCRIPTO",
      },
    })

    expect(resuelto).toEqual({
      provider: "tusfacturas",
      creds: {
        apitoken: "APITOKEN",
        apikey: "APIKEY",
        usertoken: "USERTOKEN",
        puntoVenta: 1,
        condicionFiscal: "RESPONSABLE_INSCRIPTO",
      },
    })
  })

  /**
   * Antes de la migración 299 la columna `provider` no existía y toda fila
   * era implícitamente de TusFacturas.
   */
  it("trata una fila sin provider como TusFacturas", () => {
    const resuelto = resolverCredenciales({
      organizationId: "org-1",
      production: false,
      row: {
        apitoken_enc: encryptSecret("APITOKEN"),
        apikey_enc: encryptSecret("APIKEY"),
        usertoken_enc: encryptSecret("USERTOKEN"),
        punto_venta: 1,
        condicion_fiscal: "MONOTRIBUTO",
      },
    })

    expect(resuelto.provider).toBe("tusfacturas")
  })

  /**
   * El CHECK `facturacion_credenciales_arca_completa` ya impide guardar una
   * fila `arca` sin cert/key/cuit, pero si alguna llega igual queremos un
   * error con nombre y no el `TypeError` que tiraría `decryptSecret(null)`.
   */
  it("falla con un error propio si la fila ARCA no tiene certificado", () => {
    expect(() =>
      resolverCredenciales({
        organizationId: "org-1",
        production: false,
        row: {
          provider: "arca",
          cuit: "23944498389",
          cert_pem_enc: null,
          key_pem_enc: null,
          punto_venta: 1,
          condicion_fiscal: "MONOTRIBUTO",
        },
      })
    ).toThrow(CredencialesIncompletasError)
  })

  it("falla con un error propio si la fila de TusFacturas no tiene tokens", () => {
    expect(() =>
      resolverCredenciales({
        organizationId: "org-1",
        production: false,
        row: {
          provider: "tusfacturas",
          apitoken_enc: null,
          apikey_enc: null,
          usertoken_enc: null,
          punto_venta: 1,
          condicion_fiscal: "MONOTRIBUTO",
        },
      })
    ).toThrow(CredencialesIncompletasError)
  })

  /**
   * Modelo de delegación: un único certificado —el de la plataforma— emite en
   * nombre de N talleres. La fila del taller NO tiene certificado: aporta su
   * CUIT, que viaja en `Auth.Cuit`, mientras la identidad del WSAA sale del
   * subject del certificado de STApp.
   */
  it("arma las credenciales delegadas partiendo la identidad en dos", () => {
    const resuelto = resolverCredenciales({
      organizationId: "org-1",
      production: true,
      row: {
        provider: "arca_delegado",
        cuit: "30710955057",
        cert_pem_enc: null,
        key_pem_enc: null,
        punto_venta: 4,
        condicion_fiscal: "RESPONSABLE_INSCRIPTO",
      },
    })

    expect(resuelto).toEqual({
      provider: "arca_delegado",
      creds: {
        organizationId: "org-1",
        cuit: "23944498389",
        cuitRepresentado: "30710955057",
        certPem: "CERT-PLATAFORMA",
        keyPem: "KEY-PLATAFORMA",
        puntoVenta: 4,
        condicionFiscal: "RESPONSABLE_INSCRIPTO",
        production: true,
      },
    })
  })

  it("falla si la fila delegada no trae el CUIT del taller", () => {
    expect(() =>
      resolverCredenciales({
        organizationId: "org-1",
        production: true,
        row: { provider: "arca_delegado", cuit: null, punto_venta: 1, condicion_fiscal: "MONOTRIBUTO" },
      })
    ).toThrow(CredencialesIncompletasError)
  })
})
