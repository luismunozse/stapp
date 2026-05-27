import { describe, it, expect, beforeEach } from "vitest"
import {
  rateLimit,
  getApiRateLimit,
  isExemptFromRateLimit,
  extractPublicToken,
  extractPublicCatalogoSlug,
} from "@/lib/rate-limit"

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
      expect(config.max).toBe(20)
    })

    it("retorna límites altos para webhooks", () => {
      const config = getApiRateLimit("/api/cron")
      expect(config.max).toBe(1000)
    })

    it("retorna límites estándar para APIs autenticadas", () => {
      const config = getApiRateLimit("/api/ordenes")
      expect(config.max).toBe(120)
    })
  })

  describe("isExemptFromRateLimit()", () => {
    it("exime webhooks de cron", () => {
      expect(isExemptFromRateLimit("/api/cron")).toBe(true)
    })

    it("exime sesión de auth", () => {
      expect(isExemptFromRateLimit("/api/auth/session")).toBe(true)
    })

    it("no exime rutas normales", () => {
      expect(isExemptFromRateLimit("/api/ordenes")).toBe(false)
    })
  })

  describe("extractPublicToken()", () => {
    it("extrae token de /api/public/cotizaciones/{token}/...", () => {
      expect(extractPublicToken("/api/public/cotizaciones/abc123def456")).toBe("abc123def456")
      expect(extractPublicToken("/api/public/cotizaciones/abc123def456/items")).toBe("abc123def456")
    })

    it("extrae token de /api/public/ordenes/{token}", () => {
      expect(extractPublicToken("/api/public/ordenes/0123456789abcdef")).toBe("0123456789abcdef")
    })

    it("extrae token de /api/public/kiosco/{token}", () => {
      expect(extractPublicToken("/api/public/kiosco/longenoughtoken123")).toBe("longenoughtoken123")
    })

    it("rechaza tokens muy cortos (< 12 chars)", () => {
      expect(extractPublicToken("/api/public/cotizaciones/short")).toBeNull()
    })

    it("retorna null para rutas no reconocidas", () => {
      expect(extractPublicToken("/api/public/catalogo/mi-tienda")).toBeNull()
      expect(extractPublicToken("/api/public/tenant/mi-tienda")).toBeNull()
      expect(extractPublicToken("/api/ordenes/abc123def456")).toBeNull()
    })
  })

  describe("extractPublicCatalogoSlug()", () => {
    it("extrae slug de catálogo público", () => {
      expect(extractPublicCatalogoSlug("/api/public/catalogo/mi-tienda")).toBe("mi-tienda")
      expect(extractPublicCatalogoSlug("/api/public/catalogo/mi-tienda/items")).toBe("mi-tienda")
      expect(extractPublicCatalogoSlug("/api/public/catalogo/mi-tienda/cotizar")).toBe("mi-tienda")
    })

    it("acepta slugs alfanuméricos", () => {
      expect(extractPublicCatalogoSlug("/api/public/catalogo/tienda123")).toBe("tienda123")
      expect(extractPublicCatalogoSlug("/api/public/catalogo/abc")).toBe("abc")
    })

    it("retorna null para rutas que no son catálogo", () => {
      expect(extractPublicCatalogoSlug("/api/public/cotizaciones/abc123")).toBeNull()
      expect(extractPublicCatalogoSlug("/api/catalogo/mi-tienda")).toBeNull()
    })

    it("rechaza slugs malformados", () => {
      expect(extractPublicCatalogoSlug("/api/public/catalogo/-bad")).toBeNull()
      expect(extractPublicCatalogoSlug("/api/public/catalogo/UPPER")).toBeNull()
      expect(extractPublicCatalogoSlug("/api/public/catalogo/a")).toBeNull() // mínimo 2
    })
  })
})
