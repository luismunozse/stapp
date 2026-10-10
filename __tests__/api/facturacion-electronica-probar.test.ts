// @vitest-environment node
/**
 * Tests: POST /api/facturacion-electronica/probar
 *
 * En BYO el error de configuración se detecta al subir el certificado. En
 * DELEGACIÓN el trámite vive del lado de AFIP y no hay nada que validar
 * localmente: preguntarle a AFIP es la única verificación posible.
 *
 * El endpoint devuelve 200 aunque el diagnóstico sea negativo — la request
 * funcionó, lo que falló es la delegación. Los 4xx/5xx quedan para fallas
 * del endpoint (sin sesión, sin credenciales, plataforma mal configurada).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/facturacion/crypto", () => ({
  decryptSecret: (s: string) => s,
  encryptSecret: (s: string) => s,
}))

vi.mock("@/lib/facturacion/arca/stapp-cert", () => ({
  getCertificadoStapp: vi.fn(),
  ArcaStappCertError: class ArcaStappCertError extends Error {},
}))

vi.mock("@/lib/facturacion/arca/arca-direct-provider", () => ({
  arcaDirectProvider: { probarConexion: vi.fn(), emitir: vi.fn() },
}))

vi.mock("@/lib/facturacion/arca/wsaa-ticket-store", () => ({
  WSAA_MARGIN_MS: 10 * 60 * 1000,
  WSAA_SERVICE_WSFE: "wsfe",
  leerVencimientoTicket: vi.fn(),
}))

import { leerVencimientoTicket, WSAA_MARGIN_MS } from "@/lib/facturacion/arca/wsaa-ticket-store"
import { getCertificadoStapp, ArcaStappCertError } from "@/lib/facturacion/arca/stapp-cert"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { POST } from "@/app/api/facturacion-electronica/probar/route"

const FILA_DELEGADA = {
  organization_id: "org-1",
  provider: "arca_delegado",
  cuit: "30710955057",
  punto_venta: 1,
  condicion_fiscal: "RESPONSABLE_INSCRIPTO",
}

const CERT_PLATAFORMA = {
  cuit: "23944498389",
  certPem: "CERT",
  keyPem: "KEY",
  notAfter: "2028-09-12T22:16:31.000Z",
  subject: "CN=stapp-prod",
}

describe("POST /api/facturacion-electronica/probar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCertificadoStapp).mockReturnValue(CERT_PLATAFORMA as any)
  })

  it("401 sin sesión", async () => {
    mockAuthError()
    const { status } = await parseResponse(await POST())
    expect(status).toBe(401)
  })

  it("400 cuando la organización no tiene credenciales cargadas", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ facturacion_credenciales: createChainMock(null) })

    const { status } = await parseResponse(await POST())

    expect(status).toBe(400)
  })

  it("200 con los puntos de venta cuando la delegación funciona", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ facturacion_credenciales: createChainMock(FILA_DELEGADA) })
    vi.mocked(arcaDirectProvider.probarConexion).mockResolvedValue({
      ok: true,
      puntosVenta: [{ numero: 1, bloqueado: false }],
    })

    const { status, body } = await parseResponse(await POST())

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.puntosVenta).toEqual([{ numero: 1, bloqueado: false }])
  })

  /**
   * La delegación sin hacer es el caso ESPERADO del primer uso, no un error
   * del servidor: 200 con ok:false para que la UI muestre la instrucción.
   */
  it("200 con ok:false cuando ARCA rechaza la representación", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ facturacion_credenciales: createChainMock(FILA_DELEGADA) })
    vi.mocked(arcaDirectProvider.probarConexion).mockResolvedValue({
      ok: false,
      error: "600: CUIT representada no autorizada",
    })

    const { status, body } = await parseResponse(await POST())

    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toContain("no autorizada")
  })

  describe("permisoRenuevaAt cuando ARCA todavía no reconoce la relación (600)", () => {
    const ERROR_600 = "600: ValidacionDeToken: No aparecio CUIT en lista de relaciones"

    function probarConError(error: string) {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      mockSupabaseFrom({ facturacion_credenciales: createChainMock(FILA_DELEGADA) })
      vi.mocked(arcaDirectProvider.probarConexion).mockResolvedValue({ ok: false, error })
    }

    it("lo agrega: vencimiento del ticket cacheado menos el margen de renovación", async () => {
      const vence = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
      vi.mocked(leerVencimientoTicket).mockResolvedValue(vence)
      probarConError(ERROR_600)

      const { body } = await parseResponse(await POST())

      expect(body.permisoRenuevaAt).toBe(new Date(new Date(vence).getTime() - WSAA_MARGIN_MS).toISOString())
      // Misma clave que usa el login: el certificado de plataforma, no el CUIT del taller.
      expect(leerVencimientoTicket).toHaveBeenCalledWith(
        expect.objectContaining({ cuit: CERT_PLATAFORMA.cuit, service: "wsfe" })
      )
    })

    it("no lo agrega si el error no es 600", async () => {
      vi.mocked(leerVencimientoTicket).mockResolvedValue(new Date(Date.now() + 3600_000).toISOString())
      probarConError("602: sin resultados raros")

      const { body } = await parseResponse(await POST())

      expect(body).not.toHaveProperty("permisoRenuevaAt")
      expect(leerVencimientoTicket).not.toHaveBeenCalled()
    })

    it("lo agrega si el 600 no es el primer error de la lista", async () => {
      vi.mocked(leerVencimientoTicket).mockResolvedValue(new Date(Date.now() + 3 * 3600_000).toISOString())
      probarConError("602: x; 600: y")

      const { body } = await parseResponse(await POST())

      expect(body.permisoRenuevaAt).toBeDefined()
    })

    it.each(["6000: x", "Error: timeout 600 ms", "602: x; 6001: y"])(
      "no lo agrega con falsos positivos (%s)",
      async (error) => {
        vi.mocked(leerVencimientoTicket).mockResolvedValue(new Date(Date.now() + 3 * 3600_000).toISOString())
        probarConError(error)

        const { body } = await parseResponse(await POST())

        expect(body).not.toHaveProperty("permisoRenuevaAt")
      }
    )

    it("no lo agrega si no hay ticket cacheado", async () => {
      vi.mocked(leerVencimientoTicket).mockResolvedValue(null)
      probarConError(ERROR_600)

      const { body } = await parseResponse(await POST())

      expect(body).not.toHaveProperty("permisoRenuevaAt")
    })

    it("no lo agrega si el momento ya pasó (la próxima prueba pide ticket nuevo)", async () => {
      vi.mocked(leerVencimientoTicket).mockResolvedValue(new Date(Date.now() + 5 * 60 * 1000).toISOString())
      probarConError(ERROR_600)

      const { body } = await parseResponse(await POST())

      expect(body).not.toHaveProperty("permisoRenuevaAt")
    })
  })

  it("400 cuando la organización factura por TusFacturas", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({
      facturacion_credenciales: createChainMock({
        organization_id: "org-1",
        provider: "tusfacturas",
        apitoken_enc: "a",
        apikey_enc: "b",
        usertoken_enc: "c",
        punto_venta: 1,
        condicion_fiscal: "MONOTRIBUTO",
      }),
    })

    const { status } = await parseResponse(await POST())

    expect(status).toBe(400)
    expect(arcaDirectProvider.probarConexion).not.toHaveBeenCalled()
  })

  it("500 con mensaje propio si falta el certificado de plataforma", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ facturacion_credenciales: createChainMock(FILA_DELEGADA) })
    vi.mocked(getCertificadoStapp).mockImplementation(() => {
      throw new ArcaStappCertError("ARCA_STAPP_CERT_B64 no configurada")
    })

    const { status, body } = await parseResponse(await POST())

    expect(status).toBe(500)
    expect(body.error).toMatch(/certificado de plataforma/i)
  })
})
