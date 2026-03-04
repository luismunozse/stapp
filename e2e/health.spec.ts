import { test, expect } from "@playwright/test"

test.describe("Health Check", () => {
  test("GET /api/health retorna estado del sistema", async ({ request }) => {
    const response = await request.get("/api/health")

    expect(response.status()).toBe(200)

    const body = await response.json()
    expect(body.status).toBe("healthy")
    expect(body.timestamp).toBeDefined()
    expect(body.services.database.status).toBe("ok")
    expect(body.services.database.latency_ms).toBeGreaterThanOrEqual(0)
    expect(body.version).toBeDefined()
  })

  test("Health check no requiere autenticacion", async ({ request }) => {
    const response = await request.get("/api/health", {
      headers: {
        // Sin cookies ni auth headers
      },
    })

    expect(response.status()).toBe(200)
  })
})
