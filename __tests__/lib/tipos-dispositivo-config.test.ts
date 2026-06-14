import { describe, it, expect, vi, beforeEach } from "vitest"

const maybeSingleMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
    }),
  },
}))

vi.mock("@/lib/tipos-dispositivo-defaults", () => ({
  TIPOS_BASE_CONFIG: {
    CELULAR: {
      campos: {
        imei: { visible: true, validacion: "imei" },
      },
    },
    TABLET: {
      campos: {
        imei: { visible: true },
      },
    },
  },
}))

import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"

beforeEach(() => {
  maybeSingleMock.mockReset()
})

describe("tipoValidaImei", () => {
  it("returns true when org config has imei.validacion === 'imei'", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { config: { campos: { imei: { validacion: "imei" } } } },
      error: null,
    })
    expect(await tipoValidaImei("org1", "CELULAR")).toBe(true)
  })

  it("returns false when org config has imei field but validacion !== 'imei'", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { config: { campos: { imei: { visible: true } } } },
      error: null,
    })
    expect(await tipoValidaImei("org1", "CONSOLA")).toBe(false)
  })

  it("falls back to TIPOS_BASE_CONFIG when no row found (CELULAR default validates imei)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await tipoValidaImei("org1", "CELULAR")).toBe(true)
  })

  it("falls back to TIPOS_BASE_CONFIG when no row found (TABLET default does not validate imei)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await tipoValidaImei("org1", "TABLET")).toBe(false)
  })

  it("returns false when tipo not found in DB or defaults", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await tipoValidaImei("org1", "UNKNOWN_TIPO")).toBe(false)
  })
})