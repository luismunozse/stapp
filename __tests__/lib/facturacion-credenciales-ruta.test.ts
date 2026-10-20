// @vitest-environment node
/**
 * `cargarCredencialesArca`: lo que las rutas que hablan con ARCA (anular,
 * verificar) necesitan de la fila `facturacion_credenciales` de la org. Mismo
 * mapeo que la ruta de emisión, pero SOLO para filas ARCA: una nota de crédito
 * no puede salir por TusFacturas.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/facturacion/arca/stapp-cert", () => ({
  getCertificadoStapp: vi.fn(),
  ArcaStappCertError: class ArcaStappCertError extends Error {},
}))

import { encryptSecret } from "@/lib/facturacion/crypto"
import { getCertificadoStapp, ArcaStappCertError } from "@/lib/facturacion/arca/stapp-cert"
import { cargarCredencialesArca } from "@/lib/facturacion/arca/credenciales-ruta"

const FILA_ARCA = {
  organization_id: "org-1",
  provider: "arca",
  cuit: "20111111112",
  cert_pem_enc: "",
  key_pem_enc: "",
  punto_venta: 3,
  condicion_fiscal: "MONOTRIBUTO",
}
const FILA_DELEGADA = {
  organization_id: "org-1",
  provider: "arca_delegado",
  cuit: "30711111113",
  cert_pem_enc: null,
  key_pem_enc: null,
  punto_venta: 2,
  condicion_fiscal: "RESPONSABLE_INSCRIPTO",
}
const FILA_TUSFACTURAS = {
  organization_id: "org-1",
  provider: "tusfacturas",
  apitoken_enc: "a",
  apikey_enc: "b",
  usertoken_enc: "c",
  punto_venta: 1,
  condicion_fiscal: "MONOTRIBUTO",
}

beforeAll(() => {
  process.env.FACTURACION_ENCRYPTION_KEY = "test-key-at-least-32-chars-long-xxxxx"
  FILA_ARCA.cert_pem_enc = encryptSecret("CERT-PEM")
  FILA_ARCA.key_pem_enc = encryptSecret("KEY-PEM")
})

function conFila(fila: unknown, error: unknown = null) {
  const chain = createChainMock(fila, error)
  mockSupabaseFrom({ facturacion_credenciales: chain })
  return chain
}

describe("cargarCredencialesArca", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("ARCA_ENV", "")
    vi.stubEnv("NODE_ENV", "test")
  })
  afterEach(() => vi.unstubAllEnvs())

  it("lee SOLO la fila de la organización pedida", async () => {
    const chain = conFila(FILA_ARCA)

    await cargarCredencialesArca("org-1")

    expect(supabaseAdmin.from).toHaveBeenCalledWith("facturacion_credenciales")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("fila 'arca': devuelve las credenciales con el certificado y la clave descifrados", async () => {
    conFila(FILA_ARCA)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toEqual({
      ok: true,
      provider: "arca",
      creds: {
        organizationId: "org-1",
        cuit: "20111111112",
        certPem: "CERT-PEM",
        keyPem: "KEY-PEM",
        puntoVenta: 3,
        condicionFiscal: "MONOTRIBUTO",
        production: false,
      },
    })
  })

  it("fila 'arca_delegado': usa el certificado de la plataforma y el CUIT del taller como representado", async () => {
    vi.mocked(getCertificadoStapp).mockReturnValue({
      cuit: "23222222223",
      certPem: "CERT-PLATAFORMA",
      keyPem: "KEY-PLATAFORMA",
      notAfter: "2028-09-12T22:16:31.000Z",
      subject: "CN=stapp-prod",
    } as never)
    conFila(FILA_DELEGADA)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({
      ok: true,
      provider: "arca_delegado",
      creds: {
        cuit: "23222222223",
        cuitRepresentado: "30711111113",
        certPem: "CERT-PLATAFORMA",
        keyPem: "KEY-PLATAFORMA",
        puntoVenta: 2,
        condicionFiscal: "RESPONSABLE_INSCRIPTO",
      },
    })
  })

  it("ARCA_ENV=produccion marca las credenciales como de producción", async () => {
    vi.stubEnv("ARCA_ENV", "produccion")
    conFila(FILA_ARCA)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: true, creds: { production: true } })
  })

  it("una fila de TusFacturas se rechaza con 409", async () => {
    conFila(FILA_TUSFACTURAS)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: false, status: 409 })
    if (!r.ok) expect(r.error).toMatch(/ARCA/)
  })

  it("una fila sin proveedor (anterior a la migración 299) es de TusFacturas: 409", async () => {
    conFila({ ...FILA_TUSFACTURAS, provider: undefined })

    expect(await cargarCredencialesArca("org-1")).toMatchObject({ ok: false, status: 409 })
  })

  it("TusFacturas no depende del ambiente ARCA: sin ARCA_ENV en producción sigue siendo 409, no 500", async () => {
    vi.stubEnv("NODE_ENV", "production")
    conFila(FILA_TUSFACTURAS)

    expect(await cargarCredencialesArca("org-1")).toMatchObject({ ok: false, status: 409 })
  })

  it("sin fila de credenciales: 400 'no configuradas'", async () => {
    conFila(null)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: false, status: 400 })
    if (!r.ok) expect(r.error).toMatch(/no configuradas/i)
  })

  it("error de base de datos al leer: 500", async () => {
    conFila(null, { message: "connection reset" })

    expect(await cargarCredencialesArca("org-1")).toMatchObject({ ok: false, status: 500 })
  })

  it("fila ARCA incompleta (sin certificado): 400 con el nombre de lo que falta", async () => {
    conFila({ ...FILA_ARCA, cert_pem_enc: null })

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: false, status: 400 })
    if (!r.ok) expect(r.error).toMatch(/cert_pem_enc/)
  })

  it("producción sin ARCA_ENV: 500 'ambiente no configurado' (fail closed)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    conFila(FILA_ARCA)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: false, status: 500 })
    if (!r.ok) expect(r.error).toMatch(/ambiente/i)
  })

  it("falta el certificado de la PLATAFORMA: 500 con mensaje propio, sin filtrar el detalle", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(getCertificadoStapp).mockImplementation(() => {
      throw new ArcaStappCertError("ARCA_STAPP_CERT_B64 no configurada")
    })
    conFila(FILA_DELEGADA)

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: false, status: 500 })
    if (!r.ok) {
      expect(r.error).toMatch(/certificado de plataforma/i)
      expect(r.error).not.toMatch(/ARCA_STAPP_CERT_B64/)
    }
    consoleSpy.mockRestore()
  })

  it("un certificado ilegible (no se puede descifrar): 500 genérico", async () => {
    conFila({ ...FILA_ARCA, cert_pem_enc: "no-es-un-secreto-valido" })

    const r = await cargarCredencialesArca("org-1")

    expect(r).toMatchObject({ ok: false, status: 500 })
    if (!r.ok) expect(r.error).toMatch(/credenciales/i)
  })
})
