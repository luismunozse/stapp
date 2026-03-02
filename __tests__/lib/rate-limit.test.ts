import { describe, it, expect, beforeEach } from "vitest"
import { rateLimit, getApiRateLimit, isExemptFromRateLimit } from "@/lib/rate-limit"

describe("rate-limit", () => {
  describe("rateLimit()", () => {
    it("permite requests dentro del límite", async () => {
      const id = `test-${Date.now()}-allow`
      const result = await rateLimit(id, 5, 60000)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it("bloquea requests que exceden el límite", async () => {
      const id = `test-${Date.now()}-block`
      // Consumir todo el límite
      for (let i = 0; i < 3; i++) {
        await rateLimit(id, 3, 60000)
      }
      // El siguiente debe fallar
      const result = await rateLimit(id, 3, 60000)
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it("resetea después de que expira la ventana", async () => {
      const id = `test-${Date.now()}-reset`
      // Ventana de 100ms
      for (let i = 0; i < 3; i++) {
        await rateLimit(id, 3, 100)
      }
      // Esperar a que expire
      await new Promise((r) => setTimeout(r, 150))
      const result = await rateLimit(id, 3, 100)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(2)
    })

    it("retorna remaining correcto", async () => {
      const id = `test-${Date.now()}-remaining`
      const r1 = await rateLimit(id, 5, 60000)
      expect(r1.remaining).toBe(4)
      const r2 = await rateLimit(id, 5, 60000)
      expect(r2.remaining).toBe(3)
      const r3 = await rateLimit(id, 5, 60000)
      expect(r3.remaining).toBe(2)
    })
  })

  describe("getApiRateLimit()", () => {
    it("retorna límites restrictivos para auth endpoints", () => {
      const config = getApiRateLimit("/api/auth/login")
      expect(config.max).toBe(10)
    })

    it("retorna límites para APIs públicas", () => {
      const config = getApiRateLimit("/api/public/ordenes/abc")
      expect(config.max).toBe(30)
    })

    it("retorna límites altos para webhooks", () => {
      const config = getApiRateLimit("/api/inngest")
      expect(config.max).toBe(1000)
    })

    it("retorna límites estándar para APIs autenticadas", () => {
      const config = getApiRateLimit("/api/ordenes")
      expect(config.max).toBe(120)
    })
  })

  describe("isExemptFromRateLimit()", () => {
    it("exime webhooks de Inngest", () => {
      expect(isExemptFromRateLimit("/api/inngest")).toBe(true)
    })

    it("exime sesión de auth", () => {
      expect(isExemptFromRateLimit("/api/auth/session")).toBe(true)
    })

    it("no exime rutas normales", () => {
      expect(isExemptFromRateLimit("/api/ordenes")).toBe(false)
    })
  })
})
