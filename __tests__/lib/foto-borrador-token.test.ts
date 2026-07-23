// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  generateBorradorToken,
  hashBorradorToken,
  canAcceptFoto,
  FOTO_BORRADOR_TTL_MS,
  MAX_FOTOS_POR_BORRADOR,
} from "@/lib/foto-borrador-token"

const AHORA = new Date("2026-07-23T12:00:00.000Z")
const vigente = {
  revokedAt: null,
  expiresAt: new Date(AHORA.getTime() + FOTO_BORRADOR_TTL_MS),
}

describe("token del borrador: el crudo nunca se persiste", () => {
  it("genera un token de 256 bits junto a su hash sha256", () => {
    const { raw, hash } = generateBorradorToken()
    // base64url de 32 bytes = 43 chars sin padding
    expect(raw).toHaveLength(43)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("el hash es reproducible desde el crudo, y el crudo no se deduce del hash", () => {
    const { raw, hash } = generateBorradorToken()
    expect(hashBorradorToken(raw)).toBe(hash)
    expect(hash).not.toContain(raw)
  })

  it("dos tokens seguidos no colisionan", () => {
    expect(generateBorradorToken().raw).not.toBe(generateBorradorToken().raw)
  })
})

describe("canAcceptFoto: única compuerta de aceptación", () => {
  it("acepta un borrador vigente por debajo del tope", () => {
    expect(canAcceptFoto(vigente, 0, AHORA)).toEqual({ ok: true })
  })

  it("rechaza un borrador revocado antes que cualquier otra causa", () => {
    const revocado = { revokedAt: AHORA, expiresAt: vigente.expiresAt }
    expect(canAcceptFoto(revocado, 99, AHORA)).toEqual({ ok: false, motivo: "REVOCADO" })
  })

  it("rechaza exactamente en el instante de vencimiento, no un ms después", () => {
    const borde = { revokedAt: null, expiresAt: AHORA }
    expect(canAcceptFoto(borde, 0, AHORA)).toEqual({ ok: false, motivo: "VENCIDO" })
  })

  it("sigue aceptando un milisegundo antes de vencer", () => {
    const casi = { revokedAt: null, expiresAt: new Date(AHORA.getTime() + 1) }
    expect(canAcceptFoto(casi, 0, AHORA)).toEqual({ ok: true })
  })

  it("rechaza al alcanzar el tope de fotos", () => {
    expect(canAcceptFoto(vigente, MAX_FOTOS_POR_BORRADOR, AHORA)).toEqual({
      ok: false,
      motivo: "TOPE_ALCANZADO",
    })
  })

  it("acepta expiresAt serializado como string (viene así de supabase-js)", () => {
    const desdeDb = { revokedAt: null, expiresAt: vigente.expiresAt.toISOString() }
    expect(canAcceptFoto(desdeDb, 0, AHORA)).toEqual({ ok: true })
  })
})
