import { test, expect } from "@playwright/test"

test.describe("Health Check", () => {
  test("GET /api/health retorna estado del sistema", async ({ request }) => {
    const response = await request.get("/api/health")

    // El endpoint siempre responde con el reporte de salud: 200/healthy cuando
    // la DB está accesible, 503/degraded cuando no (ej. CI sin Supabase real).
    // Verificamos el CONTRATO y la coherencia código<->estado, no que la DB
    // esté arriba (eso depende del entorno).
    expect([200, 503]).toContain(response.status())

    const body = await response.json()
    expect(["healthy", "degraded"]).toContain(body.status)
    expect(body.timestamp).toBeDefined()
    expect(["ok", "error"]).toContain(body.services.database.status)
    expect(body.services.database.latency_ms).toBeGreaterThanOrEqual(0)
    expect(body.version).toBeDefined()

    if (body.services.database.status === "ok") {
      expect(response.status()).toBe(200)
      expect(body.status).toBe("healthy")
    } else {
      expect(response.status()).toBe(503)
      expect(body.status).toBe("degraded")
    }
  })

  test("Health check no requiere autenticacion", async ({ request }) => {
    const response = await request.get("/api/health", {
      headers: {
        // Sin cookies ni auth headers
      },
    })

    // No exige autenticación: nunca responde 401/403, siempre el reporte de
    // salud (200 si la DB está ok, 503 si está degradada).
    expect([200, 503]).toContain(response.status())
  })
})
